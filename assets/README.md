# assets/

용접 시뮬레이션에 쓰는 3D 에셋입니다. 모두 m 단위이고 Y가 위쪽입니다(URDF만 Z가 위쪽). three.js가 아니어도 GLB/URDF를 읽는 툴(Blender, Isaac Sim 등)에서 그대로 쓸 수 있습니다.

| 경로 | 내용 | 원점과 축 | 출처, 라이선스 |
|---|---|---|---|
| `robots/ur5e/` | Universal Robots UR5e. `ur5e.urdf`(관절 6개, 툴 플랜지 `tool0`)와 링크별 비주얼 메시 `meshes/*.dae` | URDF 표준(Z 위). `base_link`가 바닥면 중심이고, `tool0`는 플랜지 면(+z가 플랜지 바깥) | [UniversalRobots/Universal_Robots_ROS2_Description](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description) (rolling @ 81f7c9f)의 xacro를 UR5e 설정값으로 풀어 쓴 것. BSD-3-Clause (`robots/ur5e/LICENSE`) |
| `torch/torch.glb` | 로봇용 MIG 토치(어댑터, 충돌 센서, 브래킷과 클램프, 몸통, 스완넥, 노즐, 팁, 와이어, 케이블 호스). 기본 도형으로 만든 단순 모델 | 원점이 장착면이고 +z가 플랜지 바깥이라 `tool0`에 그대로 붙입니다. 자식 노드 `TCP`가 와이어 끝 (−0.0028, 0, 0.3294)이고, 그 노드의 +z가 노즐 방향 (0.557, 0, 0.830)입니다(플랜지 축과 33.9°). 몸통은 플랜지 축과 나란히 7 cm 옆에 있습니다 | 자체 제작(`src/props/torch.js`) |
| `specimens/t-2f.glb` | T이음 2F 시편: 바닥판 300 × 180 t16 가운데에 보강판 300 × 120 t12가 섬. 용접선 270 mm, 양끝 15 mm 여유, 뒤쪽에 가접 두 개 | 바닥판 밑면이 y = 0이고, 용접하는 쪽 모서리가 x = 0, y = 0.016에서 z 방향으로 놓입니다. 용접은 +z에서 −z로 진행하고, 용접하는 쪽은 −x입니다 | 자체 제작(`src/specimens/t2f.js`) |
| `specimens/t-3f.glb` | T이음 3F 시편: 바닥판 200 × 180 t16과 보강판 200 × 120 t12가 둘 다 세워져 있음. 용접선 170 mm(아래에서 위로) | 바닥판 앞면이 x = 0(법선 −x)이고, 보강판은 −x 쪽으로 섭니다. 용접 모서리는 바닥판 앞면과 보강판 +z 면 사이에 있고, 바닥은 y = 0입니다 | 자체 제작(`src/specimens/t3f.js`) |
| `sensors/tripod-camera.glb` | 삼각대 카메라(높이 1.5 m) | 원점이 바닥의 다리 중심입니다. `head` 노드를 돌려(y 팬, x 틸트) 조준하고, `view` 노드의 −z가 시선입니다 | 자체 제작(`src/props/sensors.js`) |
| `sensors/head-camera.glb` | 안전모용 액션캠과 마운트 | 원점이 마운트 밑면입니다. `view` 노드의 −z가 시선이고 0.15 rad 아래를 봅니다 | 자체 제작 |
| `sensors/wrist-camera.glb` | 로봇 손목 뎁스 카메라(RealSense D405 크기 42 × 42 × 23 mm)와 L 브래킷 | 원점이 브래킷 발이고 `view` 노드의 −z가 시선입니다 | 자체 제작 |
| `sensors/imu.glb` | 토치 손잡이용 IMU 박스(26 × 12 × 34 mm) | 원점이 박스 중심이고 x, y, z가 센서 축입니다 | 자체 제작 |
| `sensors/quest3.glb` | Meta Quest 3 헤드셋(`quest_headset`)과 조종기 두 개(`quest_ctrl_l`, `quest_ctrl_r`). 텔레옵 장면용 | 헤드셋 원점은 두 눈 사이(앞이 +z)입니다 | Sketchfab ["Oculus Quest 3"](https://sketchfab.com/models/f4b794fc21784cd2a78392af05e0b597) by avilov, **CC BY 4.0** |
| `people/worker.glb` | 작업자(작업복, 안전모, 장갑). 리그가 없는 A-pose 메시 | 모델 단위가 cm 비슷해서 키가 72.92입니다(× 0.02414면 1.76 m). 얼굴이 +z를 봅니다. `src/human/worker.js`의 `loadWorker()`가 자동 리깅하고 크기를 맞춥니다 | Sketchfab ["Worker apl"](https://sketchfab.com/3d-models/worker-apl-89149ed089da470eb892e1c9100cc780) by max_f5_studio, **CC BY 4.0** |
| `people/welder.glb` | 용접공(리그 없음, 자세 고정, 차광면과 MIG 토치를 든 모습)과 용접기, 가스통, 케이블이 한 파일에 들어 있음 | m 단위, 바닥이 y = 0입니다. `src/human/welder.js`의 `loadWelder()`가 사람, 토치(`makeTorch()`: TCP가 원점이고 +z가 노즐), 소품으로 나눕니다 | Sketchfab ["009_Male_Worker_Welder_06"](https://sketchfab.com/3d-models/009-male-worker-welder-06-d91b45d3009440319f0b62f86ed3c249) by grewe.juergen, **CC BY 4.0** |

- **CC BY 4.0 에셋을 영상에 쓰면 출처를 화면에 적습니다.** 모델 이름, 작가, 라이선스를 적으면 되고, 엔드 카드에 넣는 것이 보통입니다(`projects/example-human` 참고).
- **토치를 다른 GLB로 바꿀 수 있습니다.** 원점(장착면)과 `TCP` 노드만 같은 규칙으로 맞춘 `assets/torch/<이름>.glb`를 두고 `?torch=<이름>`으로 렌더하면 됩니다. 가지고 있는 실제 토치 CAD를 쓸 때 이렇게 하고, 그 파일은 git에 올리지 않습니다.
- **시편, 센서, 토치는 코드가 원본이고 GLB는 거기서 구운 결과입니다.** `npm run export-assets`로 다시 만들고, `--gap 3`이나 `--gap 5`를 주면 보강판이 바닥판에서 그만큼 뜬 시편을 뽑습니다.
- `people/*.glb`는 Sketchfab 원본에서 알파가 없는 PNG 텍스처만 JPEG(q90)로 바꿔 줄인 것입니다. worker는 66 → 27 MB, welder는 48 → 44 MB(대부분 메시)이고, 형상과 해상도는 그대로입니다.
