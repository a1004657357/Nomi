/** Canonical model instructions. Display locale must never rewrite generation requests. */
export const generationPromptSource = {
  unknownImage: (v0: string | number) => `参考图片 ${v0}，只按提示词指定的用途参考`,
  firstFrame: (v0: string | number) => `首帧「${v0}」，作为视频起点并保持起始构图`,
  lastFrame: (v0: string | number) => `尾帧「${v0}」，作为视频结束状态`,
  character: (v0: string | number) => `角色「${v0}」的身份、脸、发型和服装参考，不锁定动作与构图`,
  scene: (v0: string | number) => `场景/风格「${v0}」的空间、材质、色调和固定参照物参考`,
  storyboard: (v0: string | number) => `分镜图「${v0}」，只参考景别、机位、空间关系和动作意图，不作为首帧`,
  composition: (v0: string | number) => `构图/场景「${v0}」参考，只锁定空间关系和机位`,
  prop: (v0: string | number) => `道具/视觉资产「${v0}」的造型、材质和尺度参考`,
  generic: (v0: string | number) => `参考图片「${v0}」，只按提示词指定的用途参考`,
  identitySoft: () => '保留人物的基本可识别性。',
  identityLocked: () => '锁定人物身份，不改变五官几何、脸型、年龄和可识别特征。',
}
