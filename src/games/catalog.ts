import type {
  GameRotation,
  LogicalResolution,
} from "../runtime/runtimeAdapter";

export interface CatalogGame {
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  jarUrl: string;
  midletClass: string;
  resolution: LogicalResolution;
  rotation: GameRotation;
  muted: boolean;
}

export const GAME_CATALOG: readonly CatalogGame[] = [
  {
    id: "prince-of-persia-3-two-thrones",
    title: "Prince of Persia 3: The Two Thrones",
    description: "A classic Java ME action adventure.",
    artworkUrl: "/games/prince-of-persia-3-two-thrones/icon.png",
    jarUrl:
      "/games/prince-of-persia-3-two-thrones/prince-of-persia-3-two-thrones.jar",
    midletClass: "CMidlet",
    resolution: { width: 176, height: 208 },
    rotation: "none",
    muted: false,
  },
  {
    id: "prince-of-persia-forgotten-sands",
    title: "Prince of Persia: The Forgotten Sands",
    description: "A touch-enabled Java ME action adventure.",
    artworkUrl: "/games/prince-of-persia-forgotten-sands/icon.png",
    jarUrl:
      "/games/prince-of-persia-forgotten-sands/prince-of-persia-forgotten-sands.jar",
    midletClass: "GloftPP10",
    resolution: { width: 360, height: 640 },
    rotation: "counterclockwise",
    muted: false,
  },
];
