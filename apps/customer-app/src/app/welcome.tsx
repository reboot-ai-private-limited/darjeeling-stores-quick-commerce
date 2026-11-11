import { router } from "expo-router";
import { useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Button, Icon, Screen, type IconName } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, space, type } from "../theme";

const SLIDES: { icon: IconName; title: string; body: string }[] = [
  { icon: "zap", title: "Delivered in minutes", body: "Groceries, tea and snacks from a store near you, at your door fast." },
  { icon: "heart", title: "Fresh and local", body: "Hand-picked from Darjeeling's own shelves, packed the moment you order." },
  { icon: "credit-card", title: "Pay your way", body: "Cash on delivery, or UPI, card and netbanking when you'd rather pay online." },
];

export default function Welcome() {
  const { markWelcomed } = useStore();
  const { width } = useWindowDimensions();
  const [i, setI] = useState(0);
  const list = useRef<FlatList>(null);
  const last = i === SLIDES.length - 1;
  const finish = () => { markWelcomed(); router.replace("/location"); };
  return (
    <Screen pad={false}>
      <FlatList
        ref={list} data={SLIDES} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={x => x.title}
        onMomentumScrollEnd={e => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={[s.slide, { width }]}>
            <View style={s.badge}><Icon name={item.icon} size={64} color={colors.maroon} /></View>
            <Text style={[type.title, { textAlign: "center", marginTop: space.xxl }]}>{item.title}</Text>
            <Text style={[type.body, { textAlign: "center", color: colors.muted, marginTop: space.md }]}>{item.body}</Text>
          </View>
        )}
      />
      <View style={s.dots}>{SLIDES.map((_, k) => <View key={k} style={[s.dot, k === i && s.dotOn]} />)}</View>
      <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
        <Button label={last ? "Get started" : "Next"} onPress={() => (last ? finish() : list.current?.scrollToIndex({ index: i + 1 }))} />
        {!last && <Button label="Skip" variant="ghost" onPress={finish} />}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  slide: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl * 1.5 },
  badge: { width: 168, height: 168, borderRadius: 84, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: space.xl },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.line },
  dotOn: { width: 24, backgroundColor: colors.maroon },
});
