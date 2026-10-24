# AGENTS.md

이 레포에서 용접 시뮬레이션 영상을 만드는 사람과 코딩 에이전트(Claude Code, Codex 등)를 위한 작업 안내입니다. 처음이라면 README.md를 먼저 읽으세요.

## 한 줄 요약

영상 하나는 `projects/<id>/project.js` 하나입니다. 이 파일이 장면(시편, 소품), 용접(용접선과 토치 조건), 로봇 동작 순서(steps), 카메라 샷, 자막 카드, 리그 카메라를 선언합니다. 엔진(`src/`)은 이것으로 로봇 궤적을 IK로 한 번에 풀고, 프레임마다 `seek(t)`로 그립니다. **새 영상은 `projects/example-robot` 또는 `projects/example-human`을 복사해서 시작하세요.** `src/`는 여러 프로젝트가 같이 쓰는 코드라서, 한 영상에만 필요한 것은 그 프로젝트 폴더에 둡니다.

## 명령

```bash
npm install
npm run dev                                                   # http://localhost:5180/?project=<id>&gap=3#t=12.5
npm run stills -- 2,12.5,24 --project <id> [--query gap=3]    # -> out/stills/<id>/t*.jpg
npm run render -- --project <id> [--query a=b&view=wrist] [--draft] [--from s --to s]   # -> out/<id>[-a<b>][-<view>].mp4
npm run export-assets [-- --gap 3]                            # src/specimens, src/props/*.js -> assets/*.glb
```

- 페이지는 `window.__film.seek(t)`로 아무 시간이나 그립니다.
- `?cam=x,y,z,lx,ly,lz[,fov]`로 디버그 카메라를 직접 지정할 수 있습니다.
- `?clean`을 주면 자막, HUD, 인셋 없이 그림만 나옵니다.
- `?view=<rig camera>`를 주면 그 카메라 시점으로 화면 전체를 렌더합니다(`clean`이 자동으로 켜짐).

## 좌표계

- 월드는 Y가 위쪽이고 m 단위입니다.
- 용접 테이블 상판이 y = 0이고 x는 −0.4..1.2, z는 ±0.5입니다. 바닥은 y = −0.82입니다(`src/stage.js`).
- **로봇:** UR5e 베이스가 원점에 있고 +x를 향합니다. 로봇의 오른쪽이 +z입니다.
- **로봇 2F 시편:** 용접 모서리가 x = 0.50에 있고 z를 따라 놓입니다. 용접은 +z에서 −z로 진행하고, 토치는 −x 쪽에서 들어갑니다.
- **사람 2F 시편:** 모서리가 x = −0.22에 있습니다. 사람은 x = −0.64에서 +x를 보고 섭니다.
- URDF는 Z가 위쪽입니다. `src/robot/ur5e.js`가 루트를 x축으로 −90° 돌려서 월드 = (bx, bz, −by)가 됩니다. `fk`와 `ik`는 월드 좌표를 그대로 받고 돌려줍니다.
- **토치:** `tool0`(플랜지 면, +z가 바깥)에 원점이 오도록 붙어 있습니다. TCP(와이어 끝)는 `tool0`에서 약 (0, 0, 0.33)이고 노즐 축은 플랜지 축과 33.9°입니다. **토치가 33 cm 길어서 작업 범위와 충돌이 배치를 좌우합니다.**

## project.js 형식

```js
export default {
  id, title,
  params: { gap: { default: 0, options: [0, 3, 5] } },   // ?gap=3 으로 바뀜, create()에 숫자로 들어감
  robot: false,          // (선택) 로봇 없이 사람만
  stage: { set, background, fog },   // (선택) src/stage.js 옵션
  css: true,             // (선택) projects/<id>/style.css 로드
  create(params) {
    return {
      scene,             // THREE.Group: 시편, 소품 (로봇은 엔진이 넣음)
      collide, obstacles,// 시편이 주는 스패터 충돌 함수와 박스 (buildSpecimen 반환값 그대로)
      welds: [defineWeld(id, seam, opts)],
      home,              // { q: [rad x6] } | { like: weldId, back, up } | { like, p }
      steps,             // 아래 참고
      shots(plan),       // [[시작 s, (t, u) => ({ pos, look, fov, filter? })], ...] 다음 샷 시작까지 하드 컷
      cards(plan),       // [{ cls: 'title'|'spec'|'endcard', from, to, html }]
      hud(plan),         // (선택) { from, to }: 용접 진행 길이와 관절 각도 HUD
      async setup(ctx),  // (선택) 한 번: 에셋 로드, ctx.cameras 채우기
      update(t, ctx),    // (선택) 매 프레임, 렌더 직전: 사람 포즈, 리그 카메라 sync
      postRender(t, ctx),// (선택) 매 프레임, 렌더 직후
      insets: false,     // (선택) 리그 카메라 인셋 끄기
      voice: [{ t, src }],   // (선택) 나레이션 줄(scripts/narrate.mjs로 생성), 렌더에서 섞임
      bgm: { src, gain, fadeOut },   // (선택) 배경음악(scripts/music.mjs로 생성)
    };
  },
};
```

- **`ctx`:** `{ st (renderer, scene, camera, composer, lights, bloom), robot, plan, beads, fx, cameras, overlayRoot }`
- **`steps`:** 아래 단계들을 차례로 나열하고, 각 단계에 `mark: '이름'`을 붙이면 `plan.marks.이름 = [시작, 끝]`이 됩니다.
  - `{ hold: s }`: 그대로 멈춰 있습니다.
  - `{ moveJ: 'home' | { approach: id }, dur }`: 관절 공간에서 이동합니다.
  - `{ approach: id, dur, settle }`: 토치 축을 따라 9 cm 밖에서 시작점으로 직선 진입합니다.
  - `{ weld: id }`: 아크를 켜고(preDwell), 진행하고, 크레이터(crater)를 채웁니다.
  - `{ retract: id, dur }`: 토치 축을 따라 빠집니다.
- **`plan`:** `{ duration, marks, welds, sample(t) -> q, report: { fails, worst } }`. 용접 객체 `w`에는 `arcOn`, `start`, `end`, `arcOff`, `arcPoint(t)`, `deposit(t)`, `tcp(t)`, `toolAxis(s)`, `length`가 있습니다.

### defineWeld 옵션 (`src/weld/program.js` WELD_DEFAULTS)

| 옵션 | 뜻 |
|---|---|
| `duration` | 진행 시간(초) |
| `weave`, `weaveAmp`, `weaveHz`, `dwell` | 위빙 모양, 반폭(m), 주파수, 양끝 정지 비율 |
| `workAngle`, `travelAngle` | 작업각(바닥판 A 기준), 진행각(전진각이 양수) |
| `arcGap`, `aim` | 와이어 끝과 모재 사이 거리, 모서리 밖으로 띄운 겨냥점 |
| `seed` | 시작 IK의 초기 관절각으로, 팔 자세(엘보 업/다운 등)를 고릅니다 |
| `flangeDir` | 시작할 때 플랜지 축의 대략적인 방향으로, 토치의 축 둘레 회전을 정합니다. 예: `v(0, -1, 0)` |
| `actor: 'human'` | 사람이 하는 용접입니다. 비드와 스패터는 엔진이 만들고, 토치와 몸은 프로젝트가 움직입니다 |
| `bead: { leg, convex, irregular }` | 비드 크기와 불규칙도 |

### 리그 카메라 (`src/views.js`, `src/props/sensors.js`)

```js
import { tripodCamera, headCamera, wristCamera, imu } from '../../src/props/sensors.js';
import { rigCamera } from '../../src/views.js';
// create():  const tripod = tripodCamera({ height: 2.1 }); tripod.position.set(x, FLOOR, z); scene.add(tripod);
// setup():   tripod.userData.aim(target); ctx.cameras.rear = rigCamera(tripod.getObjectByName('view'), { fov: 42, label: 'REAR CAM' });
// update():  for (const c of Object.values(ctx.cameras)) c.sync();
```

- 모든 카메라 모델에는 `view` 노드가 있고, 그 노드의 **−z가 시선**입니다.
- 로봇에 다는 카메라는 `robot.links.tool0`(또는 `wrist_3_link`)의 자식으로 붙입니다. 예시는 `example-robot`의 손목 카메라입니다.
- 사람 머리에 다는 카메라는 `loadWorker(url, { egoCam: true })`의 `egoCam` 노드에 붙입니다. 예시는 `example-human`입니다.

## 나레이션과 음악

- **키:** `.env`의 `OPENROUTER_API_KEY` 하나만 씁니다. 템플릿은 `.env.pub`입니다.
- **로그에 키를 출력하지 않습니다.** 스크립트는 `.env`에서 정규식으로 읽습니다.
- **비용(실측):**
  - ElevenLabs v4 나레이션: 1,000자에 약 $0.08
  - Lyria 3 Pro 음악: 곡 하나에 약 $0.08
- **생성한 오디오는 직접 들을 수 없는 경우가 많습니다.** 에이전트라면 길이(ffprobe)와 음량(ffmpeg volumedetect)으로 확인하고, 그렇게 확인했다고 사람에게 알립니다.

## 작업 순서와 확인 방법

1. **배치와 IK부터 확인합니다.**
   - 렌더할 때 콘솔에 `[weld] IK {"fails":0,"worstMm":0.02}`가 나와야 합니다. `fails`가 0이 아니면 그 구간에서 토치가 목표를 벗어난 것입니다.
   - 이때는 `seed`와 `flangeDir`를 바꾸거나 시편을 옮깁니다.
   - 여러 seed를 한 번에 시험하려면 페이지 안에서 `buildPlan`을 여러 번 부르는 작은 스크립트를 쓰면 빠릅니다. `example-robot`의 seed가 이렇게 찾은 값입니다.
2. **스틸로 봅니다.**
   - `npm run stills -- <times> --project <id>`로 확인합니다.
   - 샷마다 하나씩, 그리고 아크 시작, 중간, 끝을 봅니다.
   - 리그 카메라 시점은 `--query view=<name>`으로 따로 봅니다.
   - **결과 이미지를 직접 열어 확인하세요.** 숫자만 보고 끝내지 않습니다.
3. **충돌을 눈으로 확인합니다.** 토치 몸통, 호스, 손목 링크가 시편이나 테이블에 닿지 않는지 시작점과 끝점의 근접 스틸로 봅니다. 자동 충돌 검사는 아직 없습니다.
4. **렌더합니다.** `--draft`로 먼저 전체 흐름을 보고 마지막에 풀 화질로 뽑습니다.

## 지켜야 할 것

- **결정적이어야 합니다.** `Math.random()`과 `Date.now()`를 쓰지 않습니다. 대신 `src/kit.js`의 `hash(n, seed)`와 `noise1(x, seed)`를 씁니다. 프레임은 t만의 함수여야 렌더와 스크럽이 일치합니다.
- **포즈를 바꾼 뒤 월드 좌표를 읽을 때는 `updateWorldMatrix(true, false)`부터 부릅니다.** 이렇게 하지 않으면 한 프레임 전 값을 읽습니다. `rigCamera.sync()`는 이미 이렇게 합니다.
- **엔진이 매 프레임 노출, 키 라이트, 블룸을 아크에 맞춰 다시 정합니다.** 바꾸고 싶으면 `update()`에서 덮어씁니다.
- **CC BY 에셋(작업자, 용접공, Quest 3)을 쓴 영상에는 엔드 카드에 출처를 적습니다.**
- **`assets/`의 시편, 센서, 토치 GLB는 코드에서 구운 결과입니다.** 바꿀 때는 `src/specimens`나 `src/props/`를 고치고 `npm run export-assets`를 다시 돌립니다. 토치를 바꾸면 TCP와 노즐 축이 같아야 기존 IK와 seed가 그대로 맞습니다.
- **`?torch=<이름>`을 주면 `assets/torch/<이름>.glb`를 대신 씁니다.** 실제 토치 CAD처럼 레포에 올리면 안 되는 파일을 로컬에서만 쓸 때 이렇게 합니다.
- 다른 로봇 모델을 추가하면 `src/robot/ur5e.js`처럼 `fk`, `ik`, `neckCos`를 주는 어댑터를 만들면 됩니다.
- 사람 작업자 모델은 A-pose 메시를 코드에서 자동 리깅합니다(`src/human/worker.js`). `setPose()`의 옵션은 그 파일의 주석에 있습니다. 걷기, 손 IK, 시선, 허리 숙임, 발 고정을 쓸 수 있습니다.
- 용접공 모델(`welder.glb`)은 자세가 고정되어 있어 움직이지 않습니다. 여기서 쓰는 것은 MIG 토치(`makeTorch()`)와 용접기, 가스통(`props`)입니다.
