import type { CSSProperties } from "react";
import {
  AtSign,
  ArrowLeft,
  Box,
  Calendar as CalendarIcon,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  ExternalLink,
  History,
  Home,
  Image as ImageIcon,
  Inbox,
  Info,
  Link,
  Link2Off,
  List,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Minus,
  MoonStar,
  Package,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Sun,
  Tag,
  TriangleAlert,
  User,
  UserPlus,
  Users,
  X,
  type LucideProps,
} from "lucide-react";

/**
 * Icon name -> component registry (components.json declares
 * `"iconLibrary": "lucide"`, which this centralizes rather than importing
 * per call site). An explicit registry keeps tree-shaking intact — string
 * lookups against the whole lucide-react package would ship every icon in
 * the client bundle. Add the import + entry here when a screen needs a new
 * icon.
 */
const REGISTRY = {
  "arrow-left": ArrowLeft,
  "at-sign": AtSign,
  box: Box,
  calendar: CalendarIcon,
  check: Check,
  "check-check": CheckCheck,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  clock: Clock,
  coins: Coins,
  "external-link": ExternalLink,
  history: History,
  home: Home,
  image: ImageIcon,
  inbox: Inbox,
  info: Info,
  link: Link,
  "link-2-off": Link2Off,
  list: List,
  lock: Lock,
  "log-in": LogIn,
  "log-out": LogOut,
  "map-pin": MapPin,
  minus: Minus,
  "moon-star": MoonStar,
  package: Package,
  pencil: Pencil,
  phone: Phone,
  plus: Plus,
  receipt: Receipt,
  search: Search,
  settings: Settings,
  "shopping-cart": ShoppingCart,
  store: Store,
  sun: Sun,
  tag: Tag,
  "triangle-alert": TriangleAlert,
  user: User,
  "user-plus": UserPlus,
  users: Users,
  x: X,
} satisfies Record<string, React.ComponentType<LucideProps>>;

export type IconName = keyof typeof REGISTRY;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  color = "currentColor",
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Cmp = REGISTRY[name];
  return (
    <Cmp
      aria-hidden="true"
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={className}
      style={{ display: "inline-flex", color, flex: "0 0 auto", ...style }}
    />
  );
}
