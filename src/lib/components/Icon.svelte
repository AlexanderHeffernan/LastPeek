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
  import Bell from "phosphor-svelte/lib/Bell";
  import GearSix from "phosphor-svelte/lib/GearSix";
  import CheckCircle from "phosphor-svelte/lib/CheckCircle";
  import ChatCircleDots from "phosphor-svelte/lib/ChatCircleDots";
  import PlugsConnected from "phosphor-svelte/lib/PlugsConnected";
  import Monitor from "phosphor-svelte/lib/Monitor";
  import DeviceMobile from "phosphor-svelte/lib/DeviceMobile";
  import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
  import Sun from "phosphor-svelte/lib/Sun";
  import Moon from "phosphor-svelte/lib/Moon";
  import Palette from "phosphor-svelte/lib/Palette";
  import UserCircleDashed from "phosphor-svelte/lib/UserCircleDashed";
  import PaperPlaneRight from "phosphor-svelte/lib/PaperPlaneRight";
  import Smiley from "phosphor-svelte/lib/Smiley";
  import Play from "phosphor-svelte/lib/Play";
  import Pause from "phosphor-svelte/lib/Pause";
  import GithubLogo from "phosphor-svelte/lib/GithubLogo";
  import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
  import Cursor from "phosphor-svelte/lib/Cursor";
  import HandPointing from "phosphor-svelte/lib/HandPointing";
  import VideoCamera from "phosphor-svelte/lib/VideoCamera";
  import TextAa from "phosphor-svelte/lib/TextAa";
  import SpeakerHigh from "phosphor-svelte/lib/SpeakerHigh";
  import SpeakerSlash from "phosphor-svelte/lib/SpeakerSlash";
  let {
    name,
    size = 20,
    weight = "regular",
  }: {
    name: string;
    size?: number;
    weight?: "regular" | "bold" | "fill";
  } = $props();
  const icons = {
    react: Smiley,
    send: PaperPlaneRight,
    play: Play,
    pause: Pause,
    github: GithubLogo,
    shield: ShieldCheck,
    cursor: Cursor,
    pointer: HandPointing,
    video: VideoCamera,
    text: TextAa,
    guest: UserCircleDashed,
    expand: ArrowsOut,
    sound: SpeakerHigh,
    muted: SpeakerSlash,
    sun: Sun,
    moon: Moon,
    palette: Palette,
    monitor: Monitor,
    mobile: DeviceMobile,
    agents: PlugsConnected,
    done: CheckCircle,
    review: ChatCircleDots,
    bell: Bell,
    settings: GearSix,
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

{#if name === "linkedin"}
  <!-- Official monochrome [in] artwork: https://brand.linkedin.com/downloads -->
  <span
    class="linkedin-logo"
    style:width={`${size}px`}
    style:height={`${size}px`}
    aria-hidden="true"
  ></span>
{:else}
  <Glyph {size} {weight} aria-hidden="true" />
{/if}

<style>
  .linkedin-logo {
    display: inline-block;
    flex-shrink: 0;
    background: currentColor;
    mask: url("/linkedin-in.png") center / contain no-repeat;
  }
</style>
