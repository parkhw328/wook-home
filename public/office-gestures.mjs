// A visual pose is independent of task execution. Walking always takes priority;
// reduced motion keeps a legible static pose without oscillation or bobbing.
export function gesturePose(pose, time, walking = false, motion = true) {
  const t = motion ? time : 0;
  const result = { leftArm: { x: 0, z: 0 }, rightArm: { x: 0, z: 0 }, leftLeg: 0, rightLeg: 0, bob: 0, lean: 0 };
  if (walking && motion) {
    const swing = Math.sin(t * 9);
    result.leftLeg = -.45 * swing; result.rightLeg = .45 * swing;
    result.leftArm.x = .4 * swing; result.rightArm.x = -.4 * swing;
    result.bob = Math.abs(swing) * .035;
    return result;
  }
  if (pose === 'presenting') {
    result.rightArm = { x: -1.05 + Math.sin(t * 1.7) * .14, z: -.55 };
    result.leftArm = { x: -.6, z: .18 };
    result.lean = Math.sin(t * 1.4) * .025;
  } else if (pose === 'discussing') {
    result.rightArm = { x: -.62 + Math.sin(t * 2) * .2, z: -.24 };
    result.leftArm = { x: -.32 + Math.sin(t * 2 + Math.PI) * .1, z: .15 };
    result.lean = Math.sin(t * 1.6) * .035;
  } else if (pose === 'typing') {
    result.leftArm.x = -.45 + Math.sin(t * 4) * .08;
    result.rightArm.x = -.45 + Math.sin(t * 4 + Math.PI) * .08;
  }
  return result;
}
