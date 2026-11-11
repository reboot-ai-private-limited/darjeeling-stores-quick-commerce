import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { SlideInDown } from "react-native-reanimated";
import { liftIn } from "../motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardImage, defaultVariant, type Banner, type Category, type Product } from "../api/catalog";
import { useCart } from "../state/cart";
import { colors, radius, rupees, shadow, space, type } from "../theme";
import { Icon, Press, tap } from "./ui";

/** Outlined "ADD" button that turns into a − n + stepper once the item is in the cart (quick-commerce style). */
export function AddButton({ product }: { product: Product }) {
  const { qtyOf, add, remove } = useCart();
  const v = defaultVariant(product);
  if (!v) return null;
  const qty = qtyOf(v.variantId);
  if (qty === 0) {
    return (
      <Press disabled={!v.available} haptic onPress={() => add(product, v)} style={[s.addBtn, !v.available && { opacity: 0.4 }]}>
        <Text style={s.addText}>ADD</Text>
      </Press>
    );
  }
  return (
    <View style={s.stepper}>
      <Press onPress={() => { tap(); remove(v.variantId); }} style={s.stepBtn}><Icon name="minus" size={15} color={colors.white} /></Press>
      <Text style={s.stepQty}>{qty}</Text>
      <Press disabled={qty >= v.maxQty} onPress={() => { tap(); add(product, v); }} style={[s.stepBtn, qty >= v.maxQty && { opacity: 0.4 }]}><Icon name="plus" size={15} color={colors.white} /></Press>
    </View>
  );
}

export function ProductCard({ product, width = 132, eta, onPress }: { product: Product; width?: number | `${number}%`; eta?: string; onPress?: () => void }) {
  const v = defaultVariant(product);
  const img = cardImage(product);
  const out = product.availability !== "in_stock";
  return (
    <Press onPress={onPress ?? (() => router.push(`/product/${product.id}`))} style={{ width }}>
      <View style={out && { opacity: 0.6 }}>
        <View>
          <View style={s.imgWrap}>
            {img ? <Image source={{ uri: img }} style={s.img} contentFit="cover" transition={150} /> : <Icon name="package" size={32} color={colors.faint} />}
            {v && v.discountPercent > 0 && <View style={s.off}><Text style={s.offText}>{v.discountPercent}% OFF</Text></View>}
          </View>
          <View style={s.addPos}>{out ? <Text style={s.sold}>{product.availability === "closed" ? "Closed" : "Sold out"}</Text> : <AddButton product={product} />}</View>
        </View>
        {eta ? <View style={s.etaPill}><Icon name="clock" size={10} color={colors.muted} /><Text style={s.etaText}>{eta.toUpperCase()}</Text></View> : <View style={{ height: 8 }} />}
        <Text style={s.name} numberOfLines={2}>{product.name}</Text>
        <Text style={s.label} numberOfLines={1}>{v?.label ?? ""}</Text>
        <View style={s.priceRow}>
          <Text style={s.price}>{v ? rupees(v.price) : ""}</Text>
          {v && v.mrp > v.price && <Text style={s.mrp}>{rupees(v.mrp)}</Text>}
        </View>
      </View>
    </Press>
  );
}

const TINTS = ["#fff4d1", "#fde8e6", "#e8f3e1", "#e6eefb", "#f6ebdd", "#efe6f7"];
export function CategoryTile({ category, picture, tint = 0, onPress }: { category: Category; picture?: { uri: string; product: boolean }; tint?: number; onPress?: () => void }) {
  return (
    <Animated.View entering={liftIn((tint % 8) * 40)} style={{ width: "25%" }}>
    <Press onPress={onPress ?? (() => router.push({ pathname: "/category/[id]", params: { id: category.id, name: category.name } }))} haptic style={{ padding: 5 }}>
      <View style={{ alignItems: "center" }}>
        <View style={[s.catImg, { backgroundColor: TINTS[tint % TINTS.length] }]}>
          {picture ? <Image source={{ uri: picture.uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} /> : <Icon name="shopping-bag" size={26} color={colors.maroon} />}
        </View>
        <Text style={s.catName} numberOfLines={2}>{category.name}</Text>
      </View>
    </Press>
    </Animated.View>
  );
}

/** A greeting that follows the time of day, so the home page feels alive. */
export const dayPart = (d = new Date()): { hello: string; line: string } => {
  const h = d.getHours();
  if (h >= 5 && h < 11) return { hello: "Good morning", line: "Start the day with fresh Darjeeling tea" };
  if (h >= 11 && h < 16) return { hello: "Good afternoon", line: "Snacks and staples, delivered fast" };
  if (h >= 16 && h < 20) return { hello: "It's tea time", line: "Biscuits and chai go together" };
  return { hello: "Late-night cravings?", line: "We've got you covered" };
};

/** Swipeable promo banners, auto-advancing every few seconds until the customer touches them. The first slide is our delivery-time promise, from the server's ETA. */
export function BannerCarousel({ banners, eta }: { banners: Banner[]; eta: string }) {
  const { width } = useWindowDimensions();
  const w = width - space.lg * 2;
  const [i, setI] = useState(0);
  const slides: (Banner | "eta")[] = ["eta", ...banners];
  const ref = useRef<FlatList>(null);
  const touched = useRef(false);
  const iRef = useRef(0); iRef.current = i;
  const part = dayPart();
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => {
      if (touched.current) return;
      const next = (iRef.current + 1) % slides.length;
      ref.current?.scrollToOffset({ offset: next * (w + space.md), animated: true }); setI(next);
    }, 4500);
    return () => clearInterval(t);
  }, [slides.length, w]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View>
      <FlatList
        ref={ref} onScrollBeginDrag={() => { touched.current = true; }} data={slides} horizontal pagingEnabled snapToInterval={w + space.md} decelerationRate="fast" showsHorizontalScrollIndicator={false}
        keyExtractor={(b) => (b === "eta" ? "eta" : b.id)} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        onMomentumScrollEnd={e => setI(Math.round(e.nativeEvent.contentOffset.x / (w + space.md)))}
        renderItem={({ item }) => item === "eta" ? (
          <LinearGradient colors={[colors.maroon, colors.maroonSoft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.banner, { width: w }]}>
            <View style={s.etaBadge}><Icon name="zap" size={14} color={colors.maroon} /><Text style={s.etaBadgeText}>{eta}</Text></View>
            <Text style={s.bannerHello}>{part.hello}</Text>
            <Text style={s.bannerTitle}>{part.line}</Text>
          </LinearGradient>
        ) : (
          <View style={[s.banner, { width: w, backgroundColor: colors.yellow }]}>
            {item.image?.urls && <Image source={{ uri: item.image.urls["640"] ?? Object.values(item.image.urls)[0] }} style={StyleSheet.absoluteFill} contentFit="cover" />}
            {!item.image && <Text style={[s.bannerTitle, { color: colors.maroon }]}>{item.title}</Text>}
          </View>
        )}
      />
      {slides.length > 1 && <View style={s.dots}>{slides.map((_, k) => <View key={k} style={[s.dot, k === i && s.dotOn]} />)}</View>}
    </View>
  );
}

/** Slides up from the bottom once the cart has something in it. */
export function CartBar({ eta, onPress, bottom = 0 }: { eta?: string; onPress?: () => void; bottom?: number }) {
  const { count, subtotal } = useCart();
  const insets = useSafeAreaInsets();
  if (count === 0) return null;
  return (
    <Animated.View entering={SlideInDown.duration(280)} style={[s.bar, { bottom: bottom + insets.bottom + space.sm }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.barTop}>{count} {count === 1 ? "item" : "items"} · {rupees(subtotal)}</Text>
        {eta ? <Text style={s.barSub}>Arriving in {eta}</Text> : null}
      </View>
      <Press onPress={onPress ?? (() => router.push("/cart"))} haptic style={s.barBtn}><Text style={s.barBtnText}>View cart</Text><Icon name="arrow-right" size={14} color={colors.maroon} /></Press>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  addBtn: { width: 62, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: colors.maroon, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  addText: { color: colors.maroon, fontWeight: "900", fontSize: 13, letterSpacing: 0.5 },
  addPos: { position: "absolute", right: 6, bottom: -14 },
  stepper: { width: 74, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.maroon, borderRadius: 10, height: 32 },
  stepBtn: { width: 24, height: 32, alignItems: "center", justifyContent: "center" },
  stepQty: { color: colors.white, fontWeight: "900", fontSize: 14, textAlign: "center" },
  imgWrap: { height: 124, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  off: { position: "absolute", top: 0, left: 0, backgroundColor: colors.yellow, borderBottomRightRadius: radius.md, paddingHorizontal: 7, paddingVertical: 3 },
  offText: { fontSize: 10, fontWeight: "900", color: colors.maroon },
  etaPill: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", backgroundColor: colors.creamDeep, borderRadius: 6, paddingHorizontal: 5, height: 18, marginTop: 18 },
  etaText: { fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 },
  name: { fontSize: 13, fontWeight: "700", color: colors.ink, marginTop: 4, minHeight: 34, lineHeight: 17 },
  label: { fontSize: 12, color: colors.muted },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
  price: { fontSize: 14, fontWeight: "900", color: colors.ink },
  mrp: { fontSize: 11, color: colors.faint, textDecorationLine: "line-through" },
  sold: { fontSize: 11, fontWeight: "900", color: colors.red, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, overflow: "hidden" },
  catImg: { width: "100%", aspectRatio: 1, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  catName: { marginTop: 6, fontSize: 12, fontWeight: "700", color: colors.ink, textAlign: "center", minHeight: 30, lineHeight: 15 },
  banner: { height: 150, borderRadius: radius.xl, padding: space.xl, justifyContent: "flex-end", overflow: "hidden" },
  bannerHello: { color: colors.yellow, fontSize: 14, fontWeight: "900", letterSpacing: 0.5, marginBottom: 4 },
  bannerTitle: { color: colors.white, fontSize: 24, fontWeight: "900", letterSpacing: -0.6, lineHeight: 28 },
  etaBadge: { position: "absolute", top: space.lg, left: space.xl, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 10, height: 26 },
  etaBadgeText: { fontSize: 12, fontWeight: "900", color: colors.maroon },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: space.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { width: 18, backgroundColor: colors.maroon },
  bar: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", alignItems: "center", backgroundColor: colors.maroon, borderRadius: radius.lg, paddingVertical: 8, paddingLeft: space.lg, paddingRight: 8, ...shadow.lift },
  barTop: { color: colors.white, fontWeight: "800", fontSize: 13 },
  barSub: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 1 },
  barBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 14, height: 36 },
  barBtnText: { fontWeight: "900", color: colors.maroon, fontSize: 13 },
});
