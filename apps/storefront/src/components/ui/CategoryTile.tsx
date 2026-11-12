"use client";

import React from "react";
import Link from "next/link";
import { CATEGORY_TINTS } from "../../lib/theme";
import type { Category } from "../../lib/types";
import { Icon } from "./Icon";

interface CategoryTileProps {
  category: Category;
  tintIndex?: number;
  /** Picture to show: the category's own image, or a product photo from its shelf. */
  picture?: string | null | undefined;
}

export const CategoryTile: React.FC<CategoryTileProps> = ({ category, tintIndex = 0, picture }) => {
  const bg = CATEGORY_TINTS[tintIndex % CATEGORY_TINTS.length];
  const src = category.imageUrl || picture;

  return (
    <Link href={`/category/${category.id}`} className="cat-tile">
      <div className="cat-tile-avatar" style={{ backgroundColor: bg }}>
        {src ? <img src={src} alt={category.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="shopping-bag" size={26} color="var(--maroon)" />}
      </div>
      <span className="cat-tile-name">{category.name}</span>
    </Link>
  );
};
