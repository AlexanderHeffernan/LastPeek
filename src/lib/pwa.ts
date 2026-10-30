// CSS screen dimensions and pixel ratios, shared by Apple launch links and the asset generator.
// Include older SE/Plus phones, current iPhones, and full-screen iPads in both orientations.
export const appleScreens = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [414, 896, 2],
  [414, 896, 3],
  [390, 844, 3],
  [428, 926, 3],
  [393, 852, 3],
  [430, 932, 3],
  [402, 874, 3],
  [420, 912, 3],
  [440, 956, 3],
  [768, 1024, 2],
  [810, 1080, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [834, 1194, 2],
  [834, 1210, 2],
  [1024, 1366, 2],
  [1032, 1376, 2],
  [744, 1133, 2],
] as const;

export const appleLaunchImages = appleScreens.flatMap(
  ([width, height, ratio]) =>
    (["portrait", "landscape"] as const).map((orientation) => ({
      href: `/pwa/launch-${width * ratio}x${height * ratio}-${orientation}.png`,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
      width: (orientation === "portrait" ? width : height) * ratio,
      height: (orientation === "portrait" ? height : width) * ratio,
      ratio,
    })),
);
