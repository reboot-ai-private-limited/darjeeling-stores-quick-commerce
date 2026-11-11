import { useEffect } from "react";
import { StyleProp, View, ViewStyle, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { colors, radius, space } from "../theme";

/** One grey placeholder block. All blocks pulse together so a screen of them reads as one calm loading state. */
function usePulse() {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true); }, [t]);
  return useAnimatedStyle(() => ({ opacity: 0.55 + t.value * 0.45 }));
}

export function Bone({ w, h, r = radius.sm, style }: { w?: number | `${number}%`; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = usePulse();
  return <Animated.View style={[{ width: w ?? "100%", height: h, borderRadius: r, backgroundColor: colors.creamDeep }, pulse, style]} />;
}

function ProductBone() {
  return (
    <View style={{ width: 132 }}>
      <Bone h={124} r={radius.md} />
      <Bone w={50} h={14} r={6} style={{ marginTop: 20 }} />
      <Bone w="90%" h={13} style={{ marginTop: 8 }} />
      <Bone w="55%" h={12} style={{ marginTop: 6 }} />
      <Bone w="40%" h={14} style={{ marginTop: 8 }} />
    </View>
  );
}

function RailBone({ title }: { title: number }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Bone w={title} h={20} style={{ marginLeft: space.lg }} />
      <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md }}>
        {[0, 1, 2].map(i => <ProductBone key={i} />)}
      </View>
    </View>
  );
}

/** Stand-in for the Home content while the store is loading: a banner, the category grid and two product rows. */
export function HomeSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading the store">
      <View style={{ marginTop: space.lg, paddingHorizontal: space.lg }}>
        <Bone w={width - space.lg * 2} h={150} r={radius.xl} />
      </View>
      <View style={{ paddingHorizontal: space.sm, marginTop: space.lg }}>
        <Bone w={150} h={20} style={{ marginLeft: space.md }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space.md }}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={{ width: "25%", padding: 5, alignItems: "center" }}>
              <Bone h={(width - space.sm * 2) / 4 - 10} r={radius.lg} />
              <Bone w="70%" h={11} style={{ marginTop: 8 }} />
            </View>
          ))}
        </View>
      </View>
      <RailBone title={140} />
      <RailBone title={110} />
    </View>
  );
}

/** Stand-in for a product grid while a category loads: rows of grey cards, `cols` per row. */
export function GridSkeleton({ cols = 2 }: { cols?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading products" style={{ paddingTop: space.md, paddingHorizontal: cols === 2 ? space.sm : space.lg, gap: space.xl }}>
      {[0, 1, 2].map(r => (
        <View key={r} style={{ flexDirection: "row", gap: space.sm }}>
          {Array.from({ length: cols }, (_, i) => (
            <View key={i} style={{ flex: 1 }}>
              <Bone h={124} r={radius.md} />
              <Bone w={44} h={14} r={6} style={{ marginTop: 20 }} />
              <Bone w="90%" h={13} style={{ marginTop: 8 }} />
              <Bone w="55%" h={12} style={{ marginTop: 6 }} />
              <Bone w="40%" h={14} style={{ marginTop: 8 }} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Stand-in for the Categories tab: a grid of round-cornered tiles with a name line under each, four to a row. */
export function CategoryGridSkeleton({ count = 16 }: { count?: number }) {
  const { width } = useWindowDimensions();
  const tile = (width - space.sm * 2) / 4 - 10;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading categories" style={{ flexDirection: "row", flexWrap: "wrap", padding: space.sm }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: "25%", padding: 5, alignItems: "center" }}>
          <Bone h={tile} r={radius.lg} />
          <Bone w="70%" h={11} style={{ marginTop: 8 }} />
          <Bone w="45%" h={11} style={{ marginTop: 5 }} />
        </View>
      ))}
    </View>
  );
}

/** Stand-in for a category's shelves on Home: two product rows. */
export function RailsSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading products">
      <RailBone title={150} />
      <RailBone title={120} />
    </View>
  );
}
