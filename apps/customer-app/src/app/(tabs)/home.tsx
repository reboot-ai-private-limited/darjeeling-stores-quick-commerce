import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { Extrapolation, FadeInDown, FadeOutUp, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { categoryPictures, getHome, type Home as HomeData } from "../../api/catalog";
import { BadgeRails, BrandRow, BudgetRail, PopularSearches, RecentlyViewed, uniqueProducts } from "../../components/homeExtras";
import { getStoreStatus } from "../../api/cart";
import { CategoryFeed } from "../../components/CategoryFeed";
import { CategoryTabs, LiveOrderCard, OffersRow, OrderAgainCard, SectionHead } from "../../components/home";
import { BannerCarousel, CategoryTile, ProductCard } from "../../components/shop";
import { HomeSkeleton } from "../../components/Skeleton";
import { Button, Icon, Press } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, radius, shadow, space, type } from "../../theme";

/** Height of the "Delivery in … minutes" row. It slides away on scroll so only the search bar stays pinned. */
const TITLE_H = 52;
/** How far the header slides up: the title row plus the gaps around it, leaving a small gap under the status bar. */
const SLIDE = TITLE_H + space.md * 2 - space.sm;
/** Height of the category tab strip under the search bar. */
const TABS_H = 82;
const HINTS = ["tea", "snacks", "spices", "gift boxes", "biscuits"];

/** Quick-commerce home: a big delivery-time header with a pinned search bar, then banners, a dense category grid and product rows. */
export default function Home() {
  const { zone, place, booting, signedIn } = useStore();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hint, setHint] = useState(0);
  const zoneId = zone?.id;
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(e => { y.value = e.contentOffset.y; });
  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -interpolate(y.value, [0, SLIDE], [0, SLIDE], Extrapolation.CLAMP) }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, TITLE_H * 0.6], [1, 0], Extrapolation.CLAMP) }));
  const headerH = insets.top + space.md + TITLE_H + space.md + 48 + space.sm + TABS_H + space.sm;
  const [tab, setTab] = useState<string | null>(null);
  const scroller = useRef<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>(null);

  const load = useCallback(async (pull = false) => {
    if (!zoneId) return;
    if (pull) setRefreshing(true);
    setError(null);
    try { setData(await getHome(zoneId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load the store."); }
    finally { setRefreshing(false); }
  }, [zoneId]);
  useEffect(() => { void load(); }, [load]);
  // Warm the store status (free-delivery amount, minimum order) so the cart can show its bar straight away.
  useEffect(() => { if (zoneId) void getStoreStatus(zoneId).catch(() => undefined); }, [zoneId]);
  useEffect(() => { const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 2600); return () => clearInterval(t); }, []);

  if (!booting && !zone) return <Redirect href="/location" />;

  const pics = data ? categoryPictures(data.categories, data.sections) : {};
  const all = data ? uniqueProducts(data.sections) : [];
  const etaText = data ? `${data.status.etaMinMinutes}-${data.status.etaMaxMinutes} min` : "";
  const headline = data ? (data.status.accepting ? `Delivery in ${data.status.etaMaxMinutes} minutes` : "Store is closed right now") : "Delivery in minutes";

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Animated.ScrollView
        ref={scroller as never} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: headerH, paddingBottom: 190 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.maroon} colors={[colors.maroon]} progressViewOffset={headerH} />}
      >
        <View>
          {data && !data.status.accepting && (
            <Press onPress={() => router.push("/closed")} style={s.closed}><Icon name="clock" size={18} color={colors.amber} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>We're not taking orders right now. Tap to see when we open or pre-order.</Text><Icon name="chevron-right" size={16} color={colors.amber} /></Press>
          )}
          {data?.notices.map(n => <View key={n.label} style={s.notice}><Icon name="info" size={16} color={colors.amber} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{n.label}</Text></View>)}

          {!data && !error && <HomeSkeleton />}
          {error && (
            <View style={{ alignItems: "center", gap: space.md, marginTop: 60, paddingHorizontal: space.xl }}>
              <Icon name="wifi-off" size={40} color={colors.faint} />
              <Text style={[type.body, { textAlign: "center", color: colors.muted }]}>{error}</Text>
              <Button label="Try again" variant="soft" onPress={() => void load()} />
            </View>
          )}

          {data && tab && zoneId && data.categories.find(c => c.id === tab) && (
            <CategoryFeed key={tab} category={data.categories.find(c => c.id === tab)!} zoneId={zoneId} eta={etaText} />
          )}

          {data && !tab && (
            <>
              <LiveOrderCard signedIn={signedIn} />
              <View style={{ marginTop: space.lg }}><BannerCarousel banners={data.banners} eta={etaText} /></View>

              {data.categories.length > 0 && (
                <View style={{ paddingHorizontal: space.sm, marginTop: space.lg }}>
                  <Text style={[s.sectionTitle, { paddingHorizontal: space.md }]}>Shop by category</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space.md }}>
                    {data.categories.map((c, i) => <CategoryTile key={c.id} category={c} picture={pics[c.id]} tint={i} />)}
                  </View>
                </View>
              )}

              <OffersRow zoneId={zoneId} signedIn={signedIn} />
              <OrderAgainCard signedIn={signedIn} />
              <RecentlyViewed eta={etaText} />
              <BadgeRails products={all} eta={etaText} />
              <BudgetRail products={all} eta={etaText} />
              <BrandRow products={all} zoneId={zoneId} />

              {data.sections.map(sec => (
                <View key={sec.categoryId} style={{ marginTop: space.xl }}>
                  <SectionHead title={sec.title} onSeeAll={() => router.push({ pathname: "/category/[id]", params: { id: sec.categoryId, name: sec.title } })} />
                  <FlatList
                    horizontal data={sec.products} keyExtractor={p => p.id} showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md }}
                    renderItem={({ item }) => <ProductCard product={item} eta={etaText} />}
                  />
                </View>
              ))}

              <PopularSearches />

              {data.sections.length === 0 && data.categories.length === 0 && (
                <Text style={[type.body, { textAlign: "center", color: colors.muted, marginTop: 60 }]}>This store has nothing on the shelves yet.</Text>
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>
      {/* Floating header: the delivery-time row slides away on scroll; the search bar stays pinned */}
      <Animated.View style={[s.header, { paddingTop: insets.top + space.md }, headStyle]}>
        <Animated.View style={[s.headRow, { height: TITLE_H }, titleStyle]}>
          <Press onPress={() => router.push("/location")} haptic style={{ flex: 1 }}>
            <Text style={s.deliver} numberOfLines={1}>{headline}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <Text style={s.addr} numberOfLines={1}>{place?.label ?? "Choose location"}</Text>
              <Icon name="chevron-down" size={16} color={colors.yellow} />
            </View>
          </Press>
          <Press onPress={() => router.push("/notifications")} haptic style={[s.profile, { backgroundColor: "rgba(255,255,255,0.16)" }]}><Icon name="bell" size={19} color={colors.white} /></Press>
          <Press onPress={() => router.push("/account")} haptic style={s.profile}><Icon name="user" size={20} color={colors.maroon} /></Press>
        </Animated.View>
        <Press onPress={() => router.push("/search")} style={{ marginTop: space.md }}>
          <View style={s.search}>
            <Icon name="search" size={20} color={colors.muted} />
            <View style={{ flex: 1, height: 22, overflow: "hidden", justifyContent: "center" }}>
              <Animated.Text key={hint} entering={FadeInDown.duration(260)} exiting={FadeOutUp.duration(200)} style={s.hint}>Search "{HINTS[hint]}"</Animated.Text>
            </View>
          </View>
        </Press>
        {data && data.categories.length > 0 && (
          <CategoryTabs categories={data.categories} pics={pics} active={tab} onPick={id => { setTab(id); scroller.current?.scrollTo({ y: 0, animated: false }); }} />
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: colors.maroon, paddingHorizontal: space.lg, paddingBottom: space.md + 2, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  deliver: { color: colors.white, fontSize: 24, fontWeight: "900", letterSpacing: -0.6 },
  addr: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  profile: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, height: 48, borderRadius: radius.lg, backgroundColor: colors.white, paddingHorizontal: space.lg, ...shadow.card },
  hint: { fontSize: 15, fontWeight: "500", color: colors.faint },
  sectionTitle: { fontSize: 19, fontWeight: "900", letterSpacing: -0.4, color: colors.ink },
  secHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  closed: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.amberSoft },
  notice: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.yellowSoft },
});
