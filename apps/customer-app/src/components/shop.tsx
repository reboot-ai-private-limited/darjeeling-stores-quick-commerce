import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Linking } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { liftIn } from "../motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardImage, defaultVariant, type Banner, type Category, type Product, type Variant } from "../api/catalog";
import { useCart } from "../state/cart";
import { colors, radius, rupees, space, type } from "../theme";
import { Icon, Press, tap } from "./ui";

/** Pads a list with empty slots so the last row of a grid keeps its column width (a lone item no longer stretches across the screen). */
export const fillRow = <T,>(items: T[], cols: number): (T | null)[] => (items.length % cols === 0 ? items : [...items, ...Array.from({ length: cols - (items.length % cols) }, () => null)]);

/** A − n + stepper for one size of a product (one per size in the options sheet). */
function SizeStepper({ product, v }: { product: Product; v: Variant }) {
  const { qtyOf, add, remove } = useCart();
  const qty = qtyOf(v.variantId);
  if (!v.available) return <Text style={s.sold}>Sold out</Text>;
  if (qty === 0) return <Press haptic onPress={() => add(product, v)} style={s.addBtn}><Text style={s.addText}>ADD</Text></Press>;
  return (
    <View style={s.stepper}>
      <Press onPress={() => { tap(); remove(v.variantId); }} style={s.stepBtn}><Icon name="minus" size={15} color={colors.white} /></Press>
      <Text style={s.stepQty}>{qty}</Text>
      <Press disabled={qty >= v.maxQty} onPress={() => { tap(); add(product, v); }} style={[s.stepBtn, qty >= v.maxQty && { opacity: 0.4 }]}><Icon name="plus" size={15} color={colors.white} /></Press>
    </View>
  );
}

/** Bottom sheet that lists every size of a product as its own card with its price and an ADD button. */
function OptionsSheet({ product, visible, onClose }: { product: Product; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { qtyOf, count, subtotal } = useCart();
  const img = cardImage(product);
  const inCart = product.variants.reduce((n, v) => n + qtyOf(v.variantId), 0);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.sheetRoot}>
        <Animated.View entering={FadeIn.duration(180)} style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View entering={SlideInDown.duration(260)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={s.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle} numberOfLines={2}>{product.name}</Text>
              <Text style={s.sheetSub}>{product.variants.length} options</Text>
            </View>
            <Press onPress={onClose} style={s.sheetClose}><Icon name="x" size={18} color={colors.ink} /></Press>
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }} showsVerticalScrollIndicator={false}>
            {product.variants.map(v => (
              <View key={v.variantId} style={[s.optCard, !v.available && { opacity: 0.55 }]}>
                <View style={s.optImg}>{img ? <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} contentFit="contain" /> : <Icon name="package" size={26} color={colors.faint} />}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.optLabel} numberOfLines={1}>{v.label}</Text>
                  <View style={s.priceRow}>
                    <Text style={s.price}>{rupees(v.price)}</Text>
                    {v.mrp > v.price && <Text style={s.mrp}>{rupees(v.mrp)}</Text>}
                  </View>
                  {v.discountPercent > 0 && <Text style={s.optOff}>{v.discountPercent}% OFF</Text>}
                </View>
                <SizeStepper product={product} v={v} />
              </View>
            ))}
          </ScrollView>
          {inCart > 0 && (
            <Press haptic onPress={() => { onClose(); router.push("/cart"); }} style={s.sheetCart}>
              <Text style={s.sheetCartText}>{count} {count === 1 ? "item" : "items"} · {rupees(subtotal)}</Text>
              <Text style={s.sheetCartGo}>View cart</Text>
            </Press>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Outlined "ADD" button that turns into a − n + stepper once the item is in the cart (quick-commerce style).
 * A product with several sizes shows "ADD" with "N options" under it; tapping opens a sheet with a card for each size.
 */
export function AddButton({ product }: { product: Product }) {
  const { qtyOf, add, remove } = useCart();
  const [open, setOpen] = useState(false);
  const v = defaultVariant(product);
  if (!v) return null;
  if (product.variants.length > 1) {
    const total = product.variants.reduce((n, x) => n + qtyOf(x.variantId), 0);
    return (
      <>
        {total === 0 ? (
          <Press haptic onPress={() => setOpen(true)} style={s.optBtn}>
            <Text style={s.addText}>ADD</Text>
            <Text style={s.optCount}>{product.variants.length} options</Text>
          </Press>
        ) : (
          <Press haptic onPress={() => setOpen(true)} style={s.optBtnOn}>
            <Icon name="minus" size={14} color={colors.white} />
            <Text style={s.stepQty}>{total}</Text>
            <Icon name="plus" size={14} color={colors.white} />
          </Press>
        )}
        <OptionsSheet product={product} visible={open} onClose={() => setOpen(false)} />
      </>
    );
  }
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
        <Text style={s.name} numberOfLines={1} ellipsizeMode="tail">{product.name}</Text>
        <Text style={s.label} numberOfLines={1}>{v?.label ?? ""}</Text>
        <View style={s.priceRow}>
          <Text style={s.price}>{v ? rupees(v.price) : ""}</Text>
          {v && v.mrp > v.price && <Text style={s.mrp}>{rupees(v.mrp)}</Text>}
        </View>
      </View>
    </Press>
  );
}

const TINTS = ["#D7EFD9", "#F6E6E1", "#EEF1DF", "#E4ECF3", "#F3EBDD", "#EEE8F3"];
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

/** A tap on a banner opens what it points at: a category, a product or a web link. */
function openBanner(b: Banner) {
  const l = b.link;
  if (!l) return;
  if (l.type === "category" && l.id) router.push({ pathname: "/category/[id]", params: { id: l.id, name: b.title } });
  else if (l.type === "product" && l.id) router.push(`/product/${l.id}`);
  else if (l.type === "url" && l.url) void Linking.openURL(l.url).catch(() => undefined);
}

/** Swipeable promo banners, auto-advancing every few seconds until the customer touches them. The first slide is our delivery-time promise, from the server's ETA. */
export function BannerCarousel({ banners, eta }: { banners: Banner[]; eta: string }) {
  const { width } = useWindowDimensions();
  const w = width - space.lg * 2;
  const [i, setI] = useState(0);
  // The greeting slide is only a fallback for a store with no banners yet; once an admin adds banners they are all that shows.
  const slides: (Banner | "eta")[] = banners.length > 0 ? banners : ["eta"];
  const n = slides.length;
  const step = w + space.md;
  // Endless loop: a copy of the last slide sits before the first and a copy of the first after the last. Swiping onto a copy
  // jumps (without animation, unseen) to the real slide it copies, so the banner never reaches an end. `pos` counts the copies too.
  const looped = n > 1 ? [slides[n - 1]!, ...slides, slides[0]!] : slides;
  const ref = useRef<FlatList>(null);
  const touched = useRef(false);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pos = useRef(n > 1 ? 1 : 0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const part = dayPart();
  /** Called when a scroll comes to rest on position `p`: updates the dots, and silently jumps off a copy onto the real slide. */
  const settle = (p: number) => {
    if (n < 2) return;
    let at = p;
    if (p <= 0) at = n; else if (p >= n + 1) at = 1;
    if (at !== p) ref.current?.scrollToOffset({ offset: at * step, animated: false });
    pos.current = at; setI(at - 1);
  };
  useEffect(() => {
    if (n < 2) return;
    pos.current = 1; setI(0);
    const start = setTimeout(() => ref.current?.scrollToOffset({ offset: step, animated: false }), 0); // begin on the real first slide
    const t = setInterval(() => {
      if (touched.current) return;
      const next = pos.current + 1;
      ref.current?.scrollToOffset({ offset: next * step, animated: true });
      // The animation's end is not always reported, so settle on our own a moment after it should have finished.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => { if (!touched.current) settle(next); }, 600);
    }, 3500);
    return () => { clearTimeout(start); clearInterval(t); if (resume.current) clearTimeout(resume.current); if (settleTimer.current) clearTimeout(settleTimer.current); };
  }, [n, w]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View>
      <FlatList
        ref={ref} onScrollBeginDrag={() => { touched.current = true; if (resume.current) clearTimeout(resume.current); }}
        onScrollEndDrag={() => { if (resume.current) clearTimeout(resume.current); resume.current = setTimeout(() => { touched.current = false; }, 5000); }} data={looped} horizontal pagingEnabled snapToInterval={step} decelerationRate="fast" showsHorizontalScrollIndicator={false}
        keyExtractor={(b, k) => (b === "eta" ? "eta" : b.id) + (n > 1 && (k === 0 || k === n + 1) ? "-copy" : "")} getItemLayout={(_, k) => ({ length: step, offset: step * k + space.lg, index: k })} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        onMomentumScrollEnd={e => { if (settleTimer.current) clearTimeout(settleTimer.current); settle(Math.round(e.nativeEvent.contentOffset.x / step)); }}
        renderItem={({ item }) => item === "eta" ? (
          <LinearGradient colors={[colors.maroon, colors.maroonSoft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.banner, { width: w }]}>
            <View style={s.etaBadge}><Icon name="zap" size={14} color={colors.maroon} /><Text style={s.etaBadgeText}>{eta}</Text></View>
            <Text style={s.bannerHello}>{part.hello}</Text>
            <Text style={s.bannerTitle}>{part.line}</Text>
          </LinearGradient>
        ) : (
          <Press onPress={() => openBanner(item)} disabled={!item.link}>
            <View style={[s.banner, { width: w, backgroundColor: colors.yellowSoft }]}>
              {item.image?.urls && <Image source={{ uri: item.image.urls["1080"] ?? item.image.urls["640"] ?? Object.values(item.image.urls)[0] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />}
              {!item.image && <Text style={[s.bannerTitle, { color: colors.maroon }]}>{item.title}</Text>}
            </View>
          </Press>
        )}
      />
      {n > 1 && <View pointerEvents="none" style={s.dots}>{slides.map((_, k) => <View key={k} style={[s.dot, k === i && s.dotOn]} />)}</View>}
    </View>
  );
}

/** Green gradient bar that slides up from the bottom once the cart has something in it: a bag with a count, the total, and a yellow "View cart" button. */
export function CartBar({ eta, onPress, bottom = 0 }: { eta?: string; onPress?: () => void; bottom?: number }) {
  const { count, subtotal } = useCart();
  const insets = useSafeAreaInsets();
  if (count === 0) return null;
  return (
    <Animated.View entering={SlideInDown.duration(280)} style={[s.bar, { bottom: bottom + insets.bottom + space.sm }]}>
      <LinearGradient pointerEvents="none" colors={[colors.maroonSoft, colors.maroon, colors.maroonDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* A soft sheen across the top half gives the bar a little depth */}
      <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.20)", "rgba(255,255,255,0)"]} style={s.barSheen} />
      <View style={s.barIcon}>
        <Icon name="shopping-bag" size={22} color={colors.white} />
        <View style={s.barCount}><Text style={s.barCountText}>{count > 99 ? "99+" : count}</Text></View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.barTop}>{rupees(subtotal)}</Text>
        <Text style={s.barSub} numberOfLines={1}>{count} {count === 1 ? "item" : "items"} · {eta ? `Arriving in ${eta}` : "Ready to checkout"}</Text>
      </View>
      <Press onPress={onPress ?? (() => router.push("/cart"))} haptic style={s.barBtn}>
        <LinearGradient pointerEvents="none" colors={["#FFE680", "#FFD43B", "#F7B900"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        <Text style={s.barBtnText}>View cart</Text>
        <View style={s.barArrow}><Icon name="arrow-right" size={14} color={colors.maroon} /></View>
      </Press>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  addBtn: { width: 62, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: colors.green, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  addText: { color: colors.green, fontWeight: "900", fontSize: 13, letterSpacing: 0.5 },
  addPos: { position: "absolute", right: 6, bottom: -14 },
  optBtn: { width: 66, height: 42, borderRadius: 10, borderWidth: 1.5, borderColor: colors.green, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  optBtnOn: { width: 74, height: 32, borderRadius: 10, backgroundColor: colors.green, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  optCount: { color: colors.muted, fontWeight: "700", fontSize: 9.5, marginTop: -1 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill as object, backgroundColor: "rgba(15,40,30,0.45)" },
  sheet: { backgroundColor: colors.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  sheetSub: { fontSize: 12, fontWeight: "600", color: colors.muted, marginTop: 2 },
  sheetClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  optCard: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.line },
  optImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  optLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  optOff: { fontSize: 11, fontWeight: "800", color: colors.green },
  sheetCart: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.green, borderRadius: radius.lg, paddingHorizontal: space.lg, height: 50 },
  sheetCartText: { color: colors.white, fontWeight: "800", fontSize: 14 },
  sheetCartGo: { color: colors.white, fontWeight: "900", fontSize: 14 },
  stepper: { width: 74, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.green, borderRadius: 10, height: 32 },
  stepBtn: { width: 24, height: 32, alignItems: "center", justifyContent: "center" },
  stepQty: { color: colors.white, fontWeight: "900", fontSize: 14, textAlign: "center" },
  imgWrap: { height: 124, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  off: { position: "absolute", top: 0, left: 0, backgroundColor: colors.yellow, borderBottomRightRadius: radius.md, paddingHorizontal: 7, paddingVertical: 3 },
  offText: { fontSize: 10, fontWeight: "900", color: colors.maroon },
  etaPill: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", backgroundColor: colors.creamDeep, borderRadius: 6, paddingHorizontal: 5, height: 18, marginTop: 18 },
  etaText: { fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 },
  name: { fontSize: 13, fontWeight: "700", color: colors.ink, marginTop: 4, minHeight: 17, lineHeight: 17 },
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
  dots: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" },
  dotOn: { width: 18, backgroundColor: colors.yellow },
  bar: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", alignItems: "center", gap: space.md, overflow: "hidden", borderRadius: 28, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", paddingVertical: 10, paddingLeft: space.md, paddingRight: 10 },
  barSheen: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },
  barIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" },
  barCount: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.yellow, borderWidth: 2, borderColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  barCountText: { color: colors.maroon, fontSize: 10, fontWeight: "900" },
  barTop: { color: colors.white, fontWeight: "900", fontSize: 19, letterSpacing: -0.4 },
  barSub: { color: "rgba(255,255,255,0.80)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  barBtn: { flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden", borderRadius: radius.pill, paddingLeft: 18, paddingRight: 7, height: 46, borderWidth: 1, borderColor: "rgba(255,255,255,0.55)" },
  barBtnText: { fontWeight: "900", color: colors.maroon, fontSize: 15, letterSpacing: 0.2 },
  barArrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.10)", alignItems: "center", justifyContent: "center" },
});
