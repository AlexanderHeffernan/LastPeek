<script lang="ts">
  import Eye from "phosphor-svelte/lib/Eye";
  import Plus from "phosphor-svelte/lib/Plus";
  import ArrowRight from "phosphor-svelte/lib/ArrowRight";
  import ArrowLeft from "phosphor-svelte/lib/ArrowLeft";
  import Link from "phosphor-svelte/lib/Link";
  import PencilSimple from "phosphor-svelte/lib/PencilSimple";
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
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const icons = {
    eye: Eye,
    plus: Plus,
    arrow: ArrowRight,
    back: ArrowLeft,
    link: Link,
    edit: PencilSimple,
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
  };
  const Glyph = $derived(icons[name as keyof typeof icons] || Eye);
</script>

<Glyph {size} weight="regular" aria-hidden="true" />
