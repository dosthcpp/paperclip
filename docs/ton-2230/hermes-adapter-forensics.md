# TON-2230 — Hermes 어댑터 포렌식: "코드만 출력하고 뻗는다" + "컨텍스트 못 읽는다"

작성: CTO (Atlas 런타임 = `hermes_local`)
날짜: 2026-06-07

## 결론 (TL;DR)

보스 가설이 정확합니다.

1. **execute.ts 수정으로는 절대 안 고쳐집니다.** 팀이 편집해 온 `execute.ts`는 **codex-local** 어댑터(`packages/adapters/codex-local/src/server/execute.ts`)입니다. Hermes의 실행 로직은 모노레포에 **없습니다.** 외부 npm 패키지 `hermes-paperclip-adapter`(`node_modules/...`) 안에 있고, 모노레포엔 UI 표시 + 얇은 registry 래퍼만 있습니다.
2. **2달째 업데이트 안 됨도 정확.** npm 최신 publish = `0.3.0`, **2026-03-31** (오늘 기준 ~2.3개월 전). 우리는 `^0.2.0` 핀(설치본 0.2.0, 2026-03-28). 캐럿 `^0.2.0`은 `0.3.0`을 **못 받습니다**(`<0.3.0`에서 멈춤). 즉 `npm update`를 돌려도 0.2.x에 갇힙니다.

## 증거

### 1. Hermes 실행은 모노레포 밖 외부 패키지
- `server/src/adapters/registry.ts:135` → `from "hermes-paperclip-adapter/server"`
- `server/package.json:71` → `"hermes-paperclip-adapter": "^0.2.0"`
- 설치본: `server/node_modules/hermes-paperclip-adapter@0.2.0`
- 모노레포 `packages/adapters/`에 hermes 디렉터리 **없음** (codex-local, claude-local 등만 존재)
- registry.ts:436 주석이 이미 자백: *"hermes-paperclip-adapter v0.2.0 predates the authToken field"*

### 2. 왜 "코드(curl)만 출력하고 뻗나"
**(a) 단발성 실행 구조.** `execute.js`는 `hermes chat -q "<prompt>" -Q` 자식 프로세스를 **한 번** 띄우고 stdout 파싱 후 종료합니다. claude_local/codex_local 같은 **어댑터 주도 멀티턴 에이전트 루프가 없습니다.** hermes CLI가 그 한 번의 호출 안에서 하는 게 전부입니다.

**(b) 프롬프트가 "curl 쳐라"라고 시킴.** 기본 템플릿(`DEFAULT_PROMPT_TEMPLATE`)은 모델에게 *"모든 Paperclip API는 `terminal` 툴 + `curl`로 처리하라"*고 지시합니다. 그런데 hermes의 자체 툴 루프가 그 curl을 실제로 실행하지 못하면(툴셋 미설정 / TTY 승인 프롬프트에 막힘 / 모델이 그냥 텍스트로 출력) → **응답이 curl·코드 텍스트 덩어리로 끝나고 프로세스가 종료**됩니다. = "코드만 출력하고 뻗는다."

**(c) 0.3.0이 바로 이걸 고치려 했음(우리는 못 받음).** 0.2.0 → 0.3.0 diff에서 추가된 것:
- `--max-turns` (execute.js:305) — 에이전트 턴 예산. **0.2.0엔 없음** → hermes 기본 턴 한도(1턴 가능성)로 한 번 답하고 멈춤.
- `--yolo` — *"bypass dangerous-command approval prompts (agents have no TTY)"*. 에이전트엔 TTY가 없어서 0.2.0에선 위험 명령 승인 프롬프트에 걸려 curl이 실행 안 됨. 0.3.0이 우회 플래그 추가.
→ **단발 출력 후 종료 증상의 직접 원인이 0.3.0에서 패치됐는데, 우리 핀이 막고 있음.**

### 3. 왜 "컨텍스트 못 읽나"
**(a) 인스트럭션 번들 미전달 (가장 큼, 이슈 제목 그 자체).**
`registry.ts:496` → `supportsInstructionsBundle: false`, `instructionsPathKey` 없음.
→ **TOOLS.md / HEARTBEAT.md / AGENTS.md(에이전트 운영 매뉴얼)가 Hermes에 전혀 materialize/전달되지 않습니다.** claude/codex/acpx는 모두 `supportsInstructionsBundle: true` + `instructionsPathKey`로 받습니다. Hermes만 빠져 있음. → 이게 원래 이슈 제목 "tools.md랑 heartbeat.md 위치는?"의 답: **현재 Hermes 경로엔 위치가 없음(전달 자체가 안 됨).**

**(b) Wake 페이로드/스레드 미주입.** v0.2.0 프롬프트 빌더가 주입하는 건 `taskId/taskTitle/taskBody/commentId/wakeReason`뿐. **댓글 본문, wake 페이로드, continuation summary, 스레드 이력은 안 들어감.** 댓글은 "직접 curl 쳐서 읽어라"고만 시킴(2번 증상 때문에 대개 실행 실패) → 모델이 맥락을 못 봄.

**(c) 세션 연속성 깨짐 가능성 높음.** `prevSessionId = ctx.runtime?.sessionParams?.sessionId`. 신규 서버의 AdapterExecutionContext 형태가 드리프트(registry.ts:436 주석)되어 sessionParams 위치가 다르면 `--resume`가 안 걸림 → 매 wake가 기억 없는 콜드 단발 → 맥락 누적 불가.

### 4. 부수 확인: timeout falsy-zero 버그 (TON-2099 메모리) 여전히 존재
`execute.js:249/251` → `cfgNumber(config.timeoutSec) || DEFAULT_TIMEOUT_SEC` — `timeoutSec=0`이 default(300s)로 강제됨. **0.2.0·0.3.0 둘 다 미수정.** 별개 결함으로 잔존.

## 수정 경로 (execute.ts 아님)

execute.ts 한 줄 수정으로 안 되는 이유가 위 전부입니다. 실제 선택지:

- **옵션 A — 0.3.0으로 범프 (단기 완화).** `server/package.json`을 `^0.3.0`으로 올림. `--max-turns`/`--yolo`/detect-model을 얻어 "코드만 출력하고 뻗는다"는 상당 부분 완화. 단, **인스트럭션 번들/컨텍스트 주입/세션 연속성은 0.3.0도 미해결**(아키텍처 동일). AdapterExecutionContext 타입 드리프트 회귀 위험 검증 필요.
- **옵션 B — 모노레포로 vendoring/포크 (근본 해결, 권장).** Hermes를 `packages/adapters/hermes-local`로 1급 어댑터화(codex-local처럼). 그래야 팀이 직접: `supportsInstructionsBundle:true` + `instructionsPathKey` 추가(TOOLS/HEARTBEAT/AGENTS 전달), wake 컨텍스트 주입, 세션 관리, timeout falsy-zero, max-turns/yolo를 in-tree로 유지보수. 외부 패키지가 2달째 죽어 있으므로 의존을 끊는 게 맞음.
- **옵션 C — 임시 땜빵.** 에이전트 config에 양수 `timeoutSec`, 커스텀 `promptTemplate`로 컨텍스트 일부 주입, `maxTurns`(0.3.0 후) 설정. 인스트럭션 번들은 어댑터 변경 없이는 불가.

## 권고
근본 원인이 "외부 의존 동결 + Hermes 어댑터의 1급 기능 미구현"이라서 **옵션 B(vendoring) + 그 위에 인스트럭션 번들·컨텍스트 주입·세션 구현**을 권합니다. 0.3.0 범프(A)는 "출력만 하고 뻗음"의 임시 완화로만 의미. 보스/COO 승인 시 child 이슈로 분해 예정.
