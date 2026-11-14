import { useFocusEffect } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { useFavourites } from "../api/favourites";
import { fillRow, CartBar, GlassScene, ProductCard } from "../components/shop";
import { Header, Icon, Screen } from "../components/ui";
import { colors, space, type } from "../theme";

/** Products the customer saved with the heart. Kept on this phone. */
export default function Favourites() {
  const { list, reload } = useFavourites();
  useFocusEffect(reload);
  return (
    <GlassScene bar={<CartBar />}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title="Favourites" /></View>
        {list.length === 0 ? (
          <View style={{ alignItems: "center", gap: space.sm, marginTop: 80, paddingHorizontal: space.xl }}>
            <Icon name="heart" size={40} color={colors.faint} /><Text style={type.h2}>No favourites yet</Text>
            <Text style={[type.small, { textAlign: "center" }]}>Tap the heart on a product to save it here.</Text>
          </View>
        ) : (
          <FlatList
            data={fillRow(list, 3)} numColumns={3} keyExtractor={(p, i) => p?.id ?? `fill${i}`} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            renderItem={({ item }) => item ? <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View> : <View style={{ flex: 1 }} />}
          />
        )}
      </Screen>
    </GlassScene>
  );
}
