// Animaciones hechas a mano para el "modo demo" (funcionan sin IA).
// Mismo formato que devuelve la IA: rotaciones en grados [rx, ry, rz] por articulación,
// y `rootOffset` (desplazamiento del cuerpo entero, en studs).

const rest = { RightShoulder: [0, 0, 0], RightElbow: [0, 0, 0] };

function kf(time, poses, rootOffset = [0, 0, 0], easing = 'Cubic') {
  return {
    time,
    easing,
    rootOffset: { x: rootOffset[0], y: rootOffset[1], z: rootOffset[2] },
    poses: Object.entries(poses).map(([joint, [rx, ry, rz]]) => ({ joint, rx, ry, rz })),
  };
}

const crouch = {
  Waist: [-15, 0, 0],
  RightHip: [40, 0, 0], RightKnee: [-80, 0, 0], RightAnkle: [40, 0, 0],
  LeftHip: [40, 0, 0], LeftKnee: [-80, 0, 0], LeftAnkle: [40, 0, 0],
  RightShoulder: [-40, 0, 10], LeftShoulder: [-40, 0, -10],
  RightElbow: [0, 0, 0], LeftElbow: [0, 0, 0],
};
const standing = {
  Waist: [0, 0, 0],
  RightHip: [0, 0, 0], RightKnee: [0, 0, 0], RightAnkle: [0, 0, 0],
  LeftHip: [0, 0, 0], LeftKnee: [0, 0, 0], LeftAnkle: [0, 0, 0],
  RightShoulder: [0, 0, 0], LeftShoulder: [0, 0, 0],
  RightElbow: [0, 0, 0], LeftElbow: [0, 0, 0],
};

export const PRESETS = {
  saludar: {
    name: 'Saludar con la mano',
    duration: 2.2,
    loop: true,
    keyframes: [
      kf(0, { ...rest, Neck: [0, 0, 0] }),
      kf(0.35, { RightShoulder: [0, 0, 100], RightElbow: [0, 0, 50], Neck: [0, -10, -8] }),
      kf(0.65, { RightElbow: [0, 0, 100] }),
      kf(0.95, { RightElbow: [0, 0, 50] }),
      kf(1.25, { RightElbow: [0, 0, 100] }),
      kf(1.55, { RightShoulder: [0, 0, 100], RightElbow: [0, 0, 50], Neck: [0, -10, -8] }),
      kf(2.0, { ...rest, Neck: [0, 0, 0] }),
    ],
  },
  saltar: {
    name: 'Saltar',
    duration: 1.3,
    loop: true,
    keyframes: [
      kf(0, standing),
      kf(0.25, crouch, [0, -0.55, 0]),
      kf(0.55, {
        Waist: [5, 0, 0],
        RightHip: [20, 0, 0], RightKnee: [-30, 0, 0], RightAnkle: [-10, 0, 0],
        LeftHip: [20, 0, 0], LeftKnee: [-30, 0, 0], LeftAnkle: [-10, 0, 0],
        RightShoulder: [170, 0, 0], LeftShoulder: [170, 0, 0],
        RightElbow: [10, 0, 0], LeftElbow: [10, 0, 0],
      }, [0, 1.6, 0]),
      kf(0.85, crouch, [0, -0.45, 0]),
      kf(1.15, standing),
    ],
  },
  bailar: {
    name: 'Bailar',
    duration: 2,
    loop: true,
    keyframes: [
      kf(0, { Root: [0, 15, 0], Neck: [0, 0, -10], RightShoulder: [0, 0, 135], LeftShoulder: [0, 0, -20], RightElbow: [0, 0, 0], LeftElbow: [0, 0, 0],
        RightHip: [0, 0, 0], RightKnee: [0, 0, 0], RightAnkle: [0, 0, 0], LeftHip: [0, 0, 0], LeftKnee: [0, 0, 0], LeftAnkle: [0, 0, 0] }, [0.3, 0, 0]),
      kf(0.5, { Root: [0, 0, 0], Neck: [0, 0, 0], RightShoulder: [60, 0, 30], LeftShoulder: [60, 0, -30], RightElbow: [90, 0, 0], LeftElbow: [90, 0, 0],
        RightHip: [25, 0, 0], RightKnee: [-50, 0, 0], RightAnkle: [25, 0, 0], LeftHip: [25, 0, 0], LeftKnee: [-50, 0, 0], LeftAnkle: [25, 0, 0] }, [0, -0.3, 0]),
      kf(1.0, { Root: [0, -15, 0], Neck: [0, 0, 10], RightShoulder: [0, 0, 20], LeftShoulder: [0, 0, -135], RightElbow: [0, 0, 0], LeftElbow: [0, 0, 0],
        RightHip: [0, 0, 0], RightKnee: [0, 0, 0], RightAnkle: [0, 0, 0], LeftHip: [0, 0, 0], LeftKnee: [0, 0, 0], LeftAnkle: [0, 0, 0] }, [-0.3, 0, 0]),
      kf(1.5, { Root: [0, 0, 0], Neck: [0, 0, 0], RightShoulder: [60, 0, 30], LeftShoulder: [60, 0, -30], RightElbow: [90, 0, 0], LeftElbow: [90, 0, 0],
        RightHip: [25, 0, 0], RightKnee: [-50, 0, 0], RightAnkle: [25, 0, 0], LeftHip: [25, 0, 0], LeftKnee: [-50, 0, 0], LeftAnkle: [25, 0, 0] }, [0, -0.3, 0]),
      kf(2.0, { Root: [0, 15, 0], Neck: [0, 0, -10], RightShoulder: [0, 0, 135], LeftShoulder: [0, 0, -20], RightElbow: [0, 0, 0], LeftElbow: [0, 0, 0],
        RightHip: [0, 0, 0], RightKnee: [0, 0, 0], RightAnkle: [0, 0, 0], LeftHip: [0, 0, 0], LeftKnee: [0, 0, 0], LeftAnkle: [0, 0, 0] }, [0.3, 0, 0]),
    ],
  },
};
