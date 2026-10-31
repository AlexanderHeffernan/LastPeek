<script lang="ts">
  import Eye from "phosphor-svelte/lib/Eye";
  import Plus from "phosphor-svelte/lib/Plus";
  import ArrowRight from "phosphor-svelte/lib/ArrowRight";
  import ArrowLeft from "phosphor-svelte/lib/ArrowLeft";
  import Link from "phosphor-svelte/lib/Link";
  import PencilSimple from "phosphor-svelte/lib/PencilSimple";
  import NotePencil from "phosphor-svelte/lib/NotePencil";
  import ImageSquare from "phosphor-svelte/lib/ImageSquare";
  import ChatCircle from "phosphor-svelte/lib/ChatCircle";
  import Check from "phosphor-svelte/lib/Check";
  import Copy from "phosphor-svelte/lib/Copy";
  import X from "phosphor-svelte/lib/X";
  import Trash from "phosphor-svelte/lib/Trash";
  import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
  import Sparkle from "phosphor-svelte/lib/Sparkle";
  import CaretDown from "phosphor-svelte/lib/CaretDown";
  import LockSimple from "phosphor-svelte/lib/LockSimple";
  import Stack from "phosphor-svelte/lib/Stack";
  import Quotes from "phosphor-svelte/lib/Quotes";
  import ArrowBendUpLeft from "phosphor-svelte/lib/ArrowBendUpLeft";
  import XLogo from "phosphor-svelte/lib/XLogo";
  import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
  import SquaresFour from "phosphor-svelte/lib/SquaresFour";
  import Users from "phosphor-svelte/lib/Users";
  import Flag from "phosphor-svelte/lib/Flag";
  import DotsThree from "phosphor-svelte/lib/DotsThree";
  import ChartBar from "phosphor-svelte/lib/ChartBar";
  import ClockCounterClockwise from "phosphor-svelte/lib/ClockCounterClockwise";
  import Minus from "phosphor-svelte/lib/Minus";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import ArrowUp from "phosphor-svelte/lib/ArrowUp";
  let {
    name,
    size = 20,
    weight = "regular",
  }: { name: string; size?: number; weight?: "regular" | "fill" } = $props();
  const icons = {
    up: ArrowUp,
    refresh: ArrowsClockwise,
    overview: SquaresFour,
    users: Users,
    flags: Flag,
    more: DotsThree,
    chart: ChartBar,
    history: ClockCounterClockwise,
    eye: Eye,
    plus: Plus,
    arrow: ArrowRight,
    back: ArrowLeft,
    link: Link,
    edit: PencilSimple,
    drafts: NotePencil,
    image: ImageSquare,
    comment: ChatCircle,
    check: Check,
    copy: Copy,
    close: X,
    trash: Trash,
    download: DownloadSimple,
    sparkle: Sparkle,
    down: CaretDown,
    lock: LockSimple,
    thread: Stack,
    quote: Quotes,
    reply: ArrowBendUpLeft,
    x: XLogo,
    minus: Minus,
    search: MagnifyingGlass,
  };
  const Glyph = $derived(icons[name as keyof typeof icons] || Eye);
</script>

<Glyph {size} {weight} aria-hidden="true" />
