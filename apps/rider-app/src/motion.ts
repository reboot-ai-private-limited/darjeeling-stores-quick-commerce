import { Easing, withDelay, withTiming } from "react-native-reanimated";

/** One calm, no-overshoot ease for every movement in the app (no springs, no bounce). */
export const smooth = (to: number, ms = 260) => {
  "worklet";
  return withTiming(to, { duration: ms, easing: Easing.out(Easing.cubic) });
};

/**
 * Entrance animation for cards and rows: a short slide up with NO fade.
 * (On Android a card's shadow does not fade with it, so fading cards in shows a dark ghost of the shadow first.)
 */
export const liftIn = (delay = 0, distance = 14) => (values: { targetOriginY: number }) => {
  "worklet";
  return {
    initialValues: { originY: values.targetOriginY + distance },
    animations: { originY: withDelay(delay, withTiming(values.targetOriginY, { duration: 280, easing: Easing.out(Easing.cubic) })) },
    callback: () => { "worklet"; },
  };
};
