import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rememberViewed } from "../../components/homeExtras";
import { getProduct, getProducts, notifyMe, type Product, type ProductDetail } from "../../api/catalog";
import { ProductCard } from "../../components/shop";
import { ApiError } from "../../api/http";
import { Button, Icon, Press, tap } from "../../components/ui";
import { useFavourites } from "../../api/favourites";
import { useCart } from "../../state/cart";
import { useStore } from "../../state/store";
import { colors, radius, rupees, shadow, space, type } from "../../theme";

/**
 * Screen 14: one product, as a full page. The route animation (slide in, slide out) is set in the root layout.
 * The price and Add to cart bar stays pinned to the bottom of the screen.
 */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { zone, signedIn } = useStore();
  const { qtyOf, add, remove } = useCart();
  const fav = useFavourites();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [p, setP] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vi, setVi] = useState(0);
  const [img, setImg] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [similar, setSimilar] = useState<Product[]>([]);
  const gallery = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!zone) return;
    setError(null);
    try { const d = await getProduct(zone.id, id); void rememberViewed(d); setP(d); setVi(Math.max(0, d.variants.findIndex(v => v.available))); }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? "This item isn't available in your area." : e instanceof Error ? e.message : "Couldn't load this product."); }
  }, [zone, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!zone || !p) return;
    void getProducts(zone.id, p.categoryId).then(r => setSimilar(r.items.filter(x => x.id !== p.id).slice(0, 12))).catch(() => setSimilar([]));
  }, [zone, p]);

  const v = p ? p.variants[vi] ?? p.variants[0] : undefined;
  const qty = v ? qtyOf(v.variantId) : 0;
  const images = p ? p.images.map(i => i.urls["640"] ?? Object.values(i.urls)[0]).filter((u): u is string => !!u) : [];
  const soldOut = !v || !v.available;
  const etaLabel = "15-20 MINS";
  const hasDetails = !!p && !!(p.description || p.highlights?.length || p.keyInfo?.length || p.nutrition || p.infoSections?.length);

  const askNotify = async () => {
    if (!zone || !p) return;
    if (!signedIn) { router.push("/login"); return; }
    try { await notifyMe(zone.id, p.id, v?.variantId); setNote("We'll tell you when it's back."); }
    catch (e) { setNote(e instanceof ApiError && e.status === 409 ? "You're already on the list for this item." : e instanceof Error ? e.message : "Couldn't save that."); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      {/* Back and share sit on top of the page */}
      <View style={[s.topBtns, { top: insets.top + 8 }]}>
        <Press onPress={() => router.back()} haptic style={s.iconBtn}><Icon name="arrow-left" size={20} /></Press>
        {p && (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Press onPress={() => void fav.toggle(p)} haptic style={s.iconBtn}><Icon name="heart" size={18} color={fav.has(p.id) ? colors.red : colors.ink} /></Press>
            <Press onPress={() => void Share.share({ message: `${p.name} on Darjeeling Stores` })} haptic style={s.iconBtn}><Icon name="share-2" size={18} /></Press>
          </View>
        )}
      </View>

      {error ? (
        <View style={s.center}><Icon name="alert-circle" size={40} color={colors.faint} /><Text style={[type.body, { textAlign: "center", color: colors.muted }]}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View>
      ) : !p ? (
        <ActivityIndicator color={colors.maroon} style={{ marginTop: 160 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 92 + insets.bottom }}>
                {/* Gallery: main picture on white, with a thumbnail strip underneath */}
                <View style={{ backgroundColor: colors.white, paddingTop: insets.top + 56 }}>
                  {images.length > 0 ? (
                    <FlatList
                      ref={gallery} data={images} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={(u, i) => u + i}
                      onMomentumScrollEnd={e => setImg(Math.round(e.nativeEvent.contentOffset.x / width))}
                      renderItem={({ item }) => <View style={{ width, height: width * 0.62, alignItems: "center", justifyContent: "center" }}><Image source={{ uri: item }} style={{ width: "72%", height: "92%" }} contentFit="contain" transition={150} /></View>}
                    />
                  ) : <View style={{ height: width * 0.5, alignItems: "center", justifyContent: "center" }}><Icon name="package" size={56} color={colors.faint} /></View>}
                  {images.length > 1 && (
                    <View style={s.thumbs}>
                      {images.map((u, k) => (
                        <Press key={u + k} onPress={() => { setImg(k); gallery.current?.scrollToIndex({ index: k, animated: true }); }} style={[s.thumb, k === img && s.thumbOn]}>
                          <Image source={{ uri: u }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
                        </Press>
                      ))}
                    </View>
                  )}
                </View>

                <View style={{ backgroundColor: colors.white, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm }}>
                  <View style={s.etaPill}><Icon name="clock" size={12} color={colors.ink} /><Text style={s.etaPillText}>{etaLabel}</Text></View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    {p.foodType && ["veg", "vegan", "non_veg", "egg"].includes(p.foodType) && <FoodMark kind={p.foodType} />}
                    {p.badge ? <View style={s.badge}><Text style={s.badgeText}>{p.badge.replace(/_/g, " ").toUpperCase()}</Text></View> : null}
                  </View>
                  <Text style={s.title}>{p.name}</Text>
                  {p.brand && <Text style={s.brand}>{p.brand.name} ›</Text>}

                  {/* Size cards */}
                  {p.variants.length > 1 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingTop: space.md }}>
                      {p.variants.map((x, k) => (
                        <Press key={x.variantId} onPress={() => { tap(); setVi(k); }} style={[s.size, k === vi && s.sizeOn, !x.available && { opacity: 0.45 }]}>
                          {x.discountPercent > 0 && <View style={s.sizeOff}><Text style={s.sizeOffText}>{x.discountPercent}% OFF</Text></View>}
                          <Text style={[s.sizeLabel, k === vi && { color: colors.maroon }]}>{x.label}</Text>
                          <View style={{ flexDirection: "row", gap: 5, alignItems: "baseline" }}>
                            <Text style={s.sizePrice}>{rupees(x.price)}</Text>
                            {x.mrp > x.price && <Text style={s.sizeMrp}>{rupees(x.mrp)}</Text>}
                          </View>
                        </Press>
                      ))}
                    </ScrollView>
                  ) : v ? <Text style={s.single}>{v.label}</Text> : null}

                  {v && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
                      <Text style={s.price}>{rupees(v.price)}</Text>
                      {v.mrp > v.price && <Text style={s.mrp}>MRP {rupees(v.mrp)}</Text>}
                      {v.discountPercent > 0 && <View style={s.off}><Text style={s.offText}>{v.discountPercent}% OFF</Text></View>}
                    </View>
                  )}
                  <Text style={type.small}>(Inclusive of all taxes)</Text>
                  {v?.onSale && v.saleEndsAt && <Text style={[type.small, { color: colors.red }]}>Sale ends {new Date(v.saleEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Text>}

                  {hasDetails && (
                    <Press onPress={() => setShowMore(m => !m)} haptic style={{ marginTop: space.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={s.link}>{showMore ? "Hide product details" : "View product details"}</Text>
                        <Icon name={showMore ? "chevron-up" : "chevron-down"} size={18} color={colors.maroon} />
                      </View>
                    </Press>
                  )}
                </View>

                {/* Product details (opened by the link above) */}
                {hasDetails && showMore && (
                  <View style={s.details}>
                    <View style={{ gap: space.md }}>
                      {p.description ? <View><Text style={s.dLabel}>Description</Text><Text style={type.body}>{p.description}</Text></View> : null}
                      {p.highlights && p.highlights.length > 0 && <View style={{ gap: 6 }}><Text style={s.dLabel}>Highlights</Text>{p.highlights.map(h => <View key={h} style={{ flexDirection: "row", gap: 8 }}><Icon name="check" size={16} color={colors.green} /><Text style={[type.body, { flex: 1 }]}>{h}</Text></View>)}</View>}
                      {p.keyInfo?.map(k => <View key={k.label}><Text style={s.dLabel}>{k.label}</Text><Text style={type.body}>{k.value}</Text></View>)}
                      {p.nutrition && (
                        <View>
                          <Text style={s.dLabel}>Nutrition {p.nutrition.basis.replace(/_/g, " ")}</Text>
                          {p.nutrition.rows.map(r => <View key={r.name} style={s.kv}><Text style={[type.body, { flex: 1 }]}>{r.name}</Text><Text style={[type.body, { fontWeight: "700" }]}>{r.amount} {r.unit}</Text></View>)}
                        </View>
                      )}
                      {p.infoSections?.map(x => <View key={x.title}><Text style={s.dLabel}>{x.title}</Text><Text style={type.body}>{x.body}</Text></View>)}
                    </View>
                  </View>
                )}

                {/* Why shop with us */}
                <View style={s.why}>
                  <Text style={s.whyTitle}>Why shop from Darjeeling Stores?</Text>
                  {WHY.map(x => (
                    <View key={x.t} style={s.whyRow}>
                      <View style={s.whyIcon}><Icon name={x.i} size={20} color={colors.maroon} /></View>
                      <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{x.t}</Text><Text style={type.small}>{x.d}</Text></View>
                    </View>
                  ))}
                </View>

                {/* Similar products */}
                {similar.length > 0 && (
                  <View style={{ borderTopWidth: 8, borderTopColor: colors.cream, backgroundColor: colors.white, paddingTop: space.lg }}>
                    <Text style={[s.whyTitle, { paddingHorizontal: space.lg }]}>Similar products</Text>
                    <FlatList
                      horizontal data={similar} keyExtractor={x => x.id} showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md }}
                      renderItem={({ item }) => <ProductCard product={item} eta={etaLabel} onPress={() => router.push(`/product/${item.id}`)} />}
                    />
                  </View>
                )}
                {note && <Text style={[type.small, { textAlign: "center", marginTop: space.lg, color: colors.green }]}>{note}</Text>}
        </ScrollView>
      )}

      {/* Pinned bar: always at the bottom of the screen */}
      {p && (
        <View style={[s.bar, { paddingBottom: insets.bottom + space.md }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={s.barPrice}>{v ? rupees(v.price) : ""}</Text>
              {v && v.mrp > v.price && <Text style={s.mrp}>{rupees(v.mrp)}</Text>}
            </View>
            {v && v.discountPercent > 0 && <Text style={s.barOff}>{v.discountPercent}% OFF</Text>}
          </View>
          {soldOut ? (
            <Button label="Notify me" icon="bell" variant="accent" onPress={() => void askNotify()} style={{ flex: 1.3 }} />
          ) : qty === 0 ? (
            <Button label="Add to cart" onPress={() => v && add(p, v)} style={{ flex: 1.3 }} />
          ) : (
            <View style={s.stepper}>
              <Press onPress={() => { tap(); remove(v!.variantId); }} style={s.stepBtn}><Icon name="minus" size={20} color={colors.white} /></Press>
              <Text style={s.stepQty}>{qty}</Text>
              <Press disabled={qty >= v!.maxQty} onPress={() => { tap(); add(p, v!); }} style={[s.stepBtn, qty >= v!.maxQty && { opacity: 0.4 }]}><Icon name="plus" size={20} color={colors.white} /></Press>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const WHY = [
  { i: "zap" as const, t: "Superfast delivery", d: "Get your order from a store near you in minutes." },
  { i: "tag" as const, t: "Best prices and offers", d: "Fair prices on tea, snacks and spices, with offers on top." },
  { i: "shopping-bag" as const, t: "Fresh from local shelves", d: "Packed the moment you order, straight from Darjeeling." },
];

/** The green / red square mark for veg and non-veg, as on food packaging. */
function FoodMark({ kind }: { kind: string }) {
  const veg = kind === "veg" || kind === "vegan";
  const c = veg ? colors.green : colors.red;
  return <View style={{ width: 18, height: 18, borderWidth: 1.5, borderColor: c, borderRadius: 3, alignItems: "center", justifyContent: "center" }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} /></View>;
}

const s = StyleSheet.create({
  topBtns: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", justifyContent: "space-between", zIndex: 5 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  thumbs: { flexDirection: "row", justifyContent: "center", gap: space.sm, paddingVertical: space.md },
  thumb: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white, padding: 4 },
  thumbOn: { borderColor: colors.maroon },
  etaPill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.creamDeep, borderRadius: 8, paddingHorizontal: 8, height: 24 },
  etaPillText: { fontSize: 11, fontWeight: "900", color: colors.ink, letterSpacing: 0.3 },
  badge: { backgroundColor: colors.yellow, borderRadius: 6, paddingHorizontal: 8, height: 22, justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "900", color: colors.maroon, letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: "800", color: colors.ink, letterSpacing: -0.4, lineHeight: 28 },
  brand: { fontSize: 13, fontWeight: "800", color: colors.maroon },
  single: { fontSize: 14, fontWeight: "600", color: colors.muted },
  size: { minWidth: 112, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10, gap: 2 },
  sizeOn: { borderColor: colors.maroon, backgroundColor: colors.yellowSoft },
  sizeOff: { position: "absolute", top: -9, left: 10, backgroundColor: colors.yellow, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  sizeOffText: { fontSize: 9, fontWeight: "900", color: colors.maroon },
  sizeLabel: { fontSize: 14, fontWeight: "800", color: colors.ink },
  sizePrice: { fontSize: 14, fontWeight: "900", color: colors.ink },
  sizeMrp: { fontSize: 11, color: colors.faint, textDecorationLine: "line-through" },
  price: { fontSize: 26, fontWeight: "900", color: colors.ink, letterSpacing: -0.5 },
  mrp: { fontSize: 14, color: colors.faint, textDecorationLine: "line-through" },
  off: { backgroundColor: colors.yellow, borderRadius: 6, paddingHorizontal: 8, height: 24, justifyContent: "center" },
  offText: { fontSize: 12, fontWeight: "900", color: colors.maroon },
  link: { fontSize: 14, fontWeight: "800", color: colors.maroon },
  details: { borderTopWidth: 8, borderTopColor: colors.cream, backgroundColor: colors.white, padding: space.lg },
  dLabel: { fontSize: 13, fontWeight: "800", color: colors.muted, marginBottom: 2 },
  why: { borderTopWidth: 8, borderTopColor: colors.cream, backgroundColor: colors.white, padding: space.lg, gap: space.md },
  whyTitle: { fontSize: 17, fontWeight: "900", color: colors.ink, letterSpacing: -0.3 },
  whyRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  whyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  barOff: { fontSize: 12, fontWeight: "900", color: colors.green },
  kv: { flexDirection: "row", gap: space.md, paddingVertical: 2 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: space.lg, backgroundColor: colors.white, paddingHorizontal: space.lg, paddingTop: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, ...shadow.lift },
  barPrice: { fontSize: 22, fontWeight: "900", color: colors.ink },
  stepper: { flex: 1.3, height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.maroon, borderRadius: radius.lg },
  stepBtn: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  stepQty: { color: colors.white, fontWeight: "900", fontSize: 18 },
});
