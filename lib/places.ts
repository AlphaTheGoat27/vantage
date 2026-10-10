import type { LonLat } from "./geo";
import type { Port } from "./types";

// Major container/tanker ports. `staging` ports are good places to pause and reassess.
export const PORTS: Port[] = [
  { id: "CNSHA", name: "Shanghai", country: "China", center: [122.1, 31.0] },
  { id: "CNNGB", name: "Ningbo-Zhoushan", country: "China", center: [122.2, 29.9] },
  { id: "CNSZX", name: "Shenzhen", country: "China", center: [113.9, 22.4] },
  { id: "HKHKG", name: "Hong Kong", country: "China", center: [114.2, 22.25], staging: true },
  { id: "KRPUS", name: "Busan", country: "South Korea", center: [129.05, 35.05], staging: true },
  { id: "JPTYO", name: "Tokyo", country: "Japan", center: [139.8, 35.5] },
  { id: "TWKHH", name: "Kaohsiung", country: "Taiwan", center: [120.25, 22.55], staging: true },
  { id: "PHMNL", name: "Manila", country: "Philippines", center: [120.9, 14.55], staging: true },
  { id: "VNSGN", name: "Ho Chi Minh City", country: "Vietnam", center: [106.9, 10.4] },
  { id: "THLCH", name: "Laem Chabang", country: "Thailand", center: [100.85, 13.05] },
  { id: "SGSIN", name: "Singapore", country: "Singapore", center: [103.85, 1.22], staging: true },
  { id: "MYPKG", name: "Port Klang", country: "Malaysia", center: [101.3, 2.95], staging: true },
  { id: "MYTPP", name: "Tanjung Pelepas", country: "Malaysia", center: [103.55, 1.33], staging: true },
  { id: "IDJKT", name: "Jakarta (Tanjung Priok)", country: "Indonesia", center: [106.9, -6.05] },
  { id: "AUSYD", name: "Sydney", country: "Australia", center: [151.25, -33.95] },
  { id: "LKCMB", name: "Colombo", country: "Sri Lanka", center: [79.85, 6.95], staging: true },
  { id: "INNSA", name: "Nhava Sheva (Mumbai)", country: "India", center: [72.95, 18.95], staging: true },
  { id: "INMUN", name: "Mundra", country: "India", center: [69.7, 22.75] },
  { id: "BDCGP", name: "Chittagong", country: "Bangladesh", center: [91.8, 22.25] },
  { id: "PKKHI", name: "Karachi", country: "Pakistan", center: [66.95, 24.8] },
  { id: "AEJEA", name: "Jebel Ali (Dubai)", country: "UAE", center: [55.0, 25.05] },
  { id: "AEFJR", name: "Fujairah", country: "UAE", center: [56.4, 25.15], staging: true },
  { id: "OMSLL", name: "Salalah", country: "Oman", center: [54.0, 16.9], staging: true },
  { id: "SAJED", name: "Jeddah", country: "Saudi Arabia", center: [39.1, 21.45] },
  { id: "DJJIB", name: "Djibouti", country: "Djibouti", center: [43.1, 11.6] },
  { id: "EGPSD", name: "Port Said", country: "Egypt", center: [32.35, 31.3], staging: true },
  { id: "KEMBA", name: "Mombasa", country: "Kenya", center: [39.7, -4.1] },
  { id: "MUPLU", name: "Port Louis", country: "Mauritius", center: [57.5, -20.15], staging: true },
  { id: "ZADUR", name: "Durban", country: "South Africa", center: [31.05, -29.9], staging: true },
  { id: "ZACPT", name: "Cape Town", country: "South Africa", center: [18.4, -33.9], staging: true },
  { id: "NGLOS", name: "Lagos (Apapa)", country: "Nigeria", center: [3.4, 6.4] },
  { id: "TGLFW", name: "Lomé", country: "Togo", center: [1.28, 6.1] },
  { id: "MAPTM", name: "Tanger Med", country: "Morocco", center: [-5.5, 35.9], staging: true },
  { id: "ESALG", name: "Algeciras", country: "Spain", center: [-5.4, 36.1], staging: true },
  { id: "ESVLC", name: "Valencia", country: "Spain", center: [-0.3, 39.45] },
  { id: "GRPIR", name: "Piraeus", country: "Greece", center: [23.6, 37.9], staging: true },
  { id: "TRIST", name: "Istanbul (Ambarli)", country: "Turkey", center: [28.7, 40.95] },
  { id: "UAODS", name: "Odesa", country: "Ukraine", center: [30.75, 46.45] },
  { id: "ITGOA", name: "Genoa", country: "Italy", center: [8.9, 44.4] },
  { id: "NLRTM", name: "Rotterdam", country: "Netherlands", center: [4.05, 51.98] },
  { id: "BEANR", name: "Antwerp", country: "Belgium", center: [4.3, 51.35] },
  { id: "DEHAM", name: "Hamburg", country: "Germany", center: [8.7, 53.9] },
  { id: "GBFXT", name: "Felixstowe", country: "United Kingdom", center: [1.35, 51.95] },
  { id: "PLGDN", name: "Gdańsk", country: "Poland", center: [18.7, 54.45] },
  { id: "USNYC", name: "New York / New Jersey", country: "USA", center: [-74.05, 40.55] },
  { id: "USSAV", name: "Savannah", country: "USA", center: [-80.9, 32.05] },
  { id: "USHOU", name: "Houston", country: "USA", center: [-94.75, 29.3] },
  { id: "USLAX", name: "Los Angeles / Long Beach", country: "USA", center: [-118.25, 33.7] },
  { id: "USSEA", name: "Seattle / Tacoma", country: "USA", center: [-122.45, 47.65] },
  { id: "CAVAN", name: "Vancouver", country: "Canada", center: [-123.2, 49.3] },
  { id: "MXZLO", name: "Manzanillo", country: "Mexico", center: [-104.3, 19.05] },
  { id: "PABLB", name: "Balboa (Panama)", country: "Panama", center: [-79.55, 8.9], staging: true },
  { id: "PAONX", name: "Colón (Panama)", country: "Panama", center: [-79.9, 9.4], staging: true },
  { id: "JMKIN", name: "Kingston", country: "Jamaica", center: [-76.8, 17.95], staging: true },
  { id: "BRSSZ", name: "Santos", country: "Brazil", center: [-46.3, -24.05] },
  { id: "ARBUE", name: "Buenos Aires", country: "Argentina", center: [-57.9, -34.6] },
  { id: "CLSAI", name: "San Antonio", country: "Chile", center: [-71.65, -33.6] },
  { id: "PECLL", name: "Callao", country: "Peru", center: [-77.2, -12.05] },
];

export const portById = (id: string) => PORTS.find((p) => p.id === id);

// Named sea waypoints the AI replanner may route through (each sits on the sea-lane network).
export const WAYPOINTS: Record<string, LonLat> = {
  "Cape of Good Hope": [19.5, -35.5],
  "Suez Canal": [32.55, 30.0],
  "Panama Canal": [-79.7, 9.2],
  "Strait of Malacca": [100.5, 3.5],
  "Sunda Strait": [105.8, -6.0],
  "Lombok Strait": [115.75, -8.6],
  "Strait of Gibraltar": [-5.6, 35.95],
  "Cape Horn": [-67.3, -56.3],
  "Strait of Magellan": [-70.5, -53.2],
  "Bab el-Mandeb": [43.35, 12.6],
  "Strait of Hormuz": [56.5, 26.4],
  "Taiwan Strait": [119.8, 24.4],
  "East of Taiwan (Philippine Sea)": [123.5, 22.5],
  "Luzon Strait": [121.2, 20.5],
  "Mozambique Channel": [41.5, -18.5],
  "South of Madagascar": [46.0, -28.0],
  "Southern Indian Ocean": [70.0, -15.0],
  "Off Sri Lanka": [80.5, 5.5],
  "Arabian Sea (open water)": [63.0, 14.0],
  "Mid Atlantic": [-30.0, 20.0],
  "West Africa offshore": [-20.0, 5.0],
  "Bosporus": [29.05, 41.15],
  "English Channel": [1.0, 50.5],
};

/** Maritime security zones watched through live news. */
export type WatchZone = {
  id: string;
  name: string;
  center: LonLat;
  radiusKm: number;
  query: string;
  mustMatch: RegExp;
  defaultCategory: "armed-conflict" | "piracy" | "military-tension" | "congestion";
};

const ship = "(ship OR vessel OR tanker OR shipping OR containership OR freighter)";

export const WATCH_ZONES: WatchZone[] = [
  { id: "red-sea", name: "Southern Red Sea & Bab el-Mandeb", center: [42.3, 14.8], radiusKm: 520, query: `("Red Sea" OR "Bab el-Mandeb" OR Houthi) ${ship}`, mustMatch: /red sea|bab el|mandeb|houthi|yemen|hodeidah/i, defaultCategory: "armed-conflict" },
  { id: "gulf-of-aden", name: "Gulf of Aden & Somali coast", center: [49.5, 12.3], radiusKm: 480, query: `("Gulf of Aden" OR Somalia OR Somali) (pirates OR piracy OR hijacked OR ${ship.slice(1, -1)})`, mustMatch: /aden|somali|puntland|pirat|hijack/i, defaultCategory: "piracy" },
  { id: "hormuz", name: "Strait of Hormuz & Gulf of Oman", center: [56.6, 25.9], radiusKm: 420, query: `("Strait of Hormuz" OR "Gulf of Oman" OR "Persian Gulf") ${ship}`, mustMatch: /hormuz|gulf of oman|persian gulf|iran/i, defaultCategory: "military-tension" },
  { id: "black-sea", name: "Black Sea", center: [33.5, 43.6], radiusKm: 520, query: `("Black Sea" OR Odesa OR Novorossiysk) ${ship}`, mustMatch: /black sea|odesa|odessa|novorossiysk|ukrain|crimea/i, defaultCategory: "armed-conflict" },
  { id: "east-med", name: "Eastern Mediterranean (Levant)", center: [34.2, 33.2], radiusKm: 280, query: `(Israel OR Lebanon OR Gaza OR Haifa OR Beirut) (port OR ${ship.slice(1, -1)})`, mustMatch: /israel|lebanon|gaza|haifa|beirut|levant/i, defaultCategory: "armed-conflict" },
  { id: "gulf-of-guinea", name: "Gulf of Guinea", center: [3.5, 2.5], radiusKm: 650, query: `("Gulf of Guinea") (piracy OR pirates OR kidnapped OR ${ship.slice(1, -1)})`, mustMatch: /guinea|nigeria|pirat|kidnap/i, defaultCategory: "piracy" },
  { id: "malacca", name: "Malacca & Singapore Straits", center: [102.2, 2.4], radiusKm: 380, query: `("Singapore Strait" OR "Strait of Malacca" OR "Malacca Strait") ${ship}`, mustMatch: /singapore|malacca/i, defaultCategory: "piracy" },
  { id: "south-china-sea", name: "South China Sea", center: [114.5, 13.5], radiusKm: 750, query: `("South China Sea" OR "Scarborough" OR "Second Thomas") (coast guard OR clash OR military OR ${ship.slice(1, -1)})`, mustMatch: /south china sea|scarborough|second thomas|spratly|paracel/i, defaultCategory: "military-tension" },
  { id: "taiwan-strait", name: "Taiwan Strait", center: [119.8, 24.3], radiusKm: 300, query: `("Taiwan Strait") (drills OR blockade OR military OR exercise OR ${ship.slice(1, -1)})`, mustMatch: /taiwan/i, defaultCategory: "military-tension" },
  { id: "panama", name: "Panama Canal", center: [-79.7, 9.1], radiusKm: 180, query: `("Panama Canal") (delays OR restrictions OR drought OR earthquake OR transits OR queue)`, mustMatch: /panama/i, defaultCategory: "congestion" },
  { id: "suez", name: "Suez Canal", center: [32.45, 30.4], radiusKm: 160, query: `("Suez Canal") (transits OR diversion OR closure OR traffic OR attack)`, mustMatch: /suez/i, defaultCategory: "congestion" },
  { id: "baltic", name: "Baltic Sea", center: [20.0, 57.0], radiusKm: 450, query: `("Baltic Sea") (sabotage OR cable OR "shadow fleet" OR drone OR navy)`, mustMatch: /baltic/i, defaultCategory: "military-tension" },
];
