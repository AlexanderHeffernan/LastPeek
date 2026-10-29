<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Brand from "$lib/components/Brand.svelte";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  let { data, form } = $props();
  let busy = $state(false);
  function versionURL(number: number) {
    const url = new URL(page.url.href);
    url.searchParams.set("v", String(number));
    return url.pathname + url.search;
  }
</script>

<svelte:head><title>A second look · LastPeek</title></svelte:head>
<header class="topbar">
  <Brand href="/login" /><a class="small muted" href="/login"
    >Sign in<Icon name="arrow" size={12} /></a
  >
</header>
<main class="workspace">
  <div class="workspace-toolbar">
    <span class="breadcrumb">Draft review</span>
    <div class="row">
      <Badge variant="secondary" class="green">Shared draft</Badge><label
        class="small muted"
        >Version<select
          aria-label="Review version"
          style="display:inline-block;margin:0 0 0 8px;width:auto;min-height:40px"
          value={data.revision}
          onchange={(event) =>
            goto(versionURL(Number(event.currentTarget.value)))}
          >{#each data.revisions as revision}<option value={revision.number}
              >v{revision.number}{revision.number === data.latest
                ? " · Latest"
                : ""}</option
            >{/each}</select
        ></label
      >
    </div>
  </div>
  {#if data.revision !== data.latest}<div
      class="notice"
      style="margin-bottom:20px"
    >
      You’re looking at an earlier version. <a href={`/r/${data.token}`}
        >See the latest version →</a
      >
    </div>{/if}
  <div class="workspace-grid">
    <section>
      <div class="post-panel">
        <div class="panel-heading">
          <span class="small">{data.content.title || "Draft"}</span><Badge
            variant="secondary">Version {data.revision}</Badge
          >
        </div>
        <PostPreview
          content={data.content}
          media={data.media}
          token={data.token}
        />
      </div>
    </section>
    <aside class="feedback-column" aria-label="Feedback">
      <div class="feedback-heading">
        <h2>Feedback</h2>
      </div>
      <FeedbackList
        comments={data.comments}
        revision={data.revision}
        content={data.content}
        onversion={(number) => goto(versionURL(number))}
      />
      <form
        class="feedback-form"
        method="POST"
        action="?/comment"
        use:enhance={() => {
          busy = true;
          return async ({ result, update }) => {
            await update({
              reset: result.type === "success",
              invalidateAll: true,
            });
            busy = false;
          };
        }}
      >
        <h3 style="margin:0">Leave feedback</h3>
        <input type="hidden" name="revision" value={data.revision} />
        <label
          >Post<select name="postId" aria-label="Feedback post"
            >{#each data.content.posts as post, index}<option value={post.id}
                >Post {index + 1}: {post.text.slice(0, 20) || "Media post"}{post
                  .text.length > 20
                  ? "…"
                  : ""}</option
              >{/each}</select
          ></label
        >
        <label
          >Your name<Input
            name="name"
            autocomplete="given-name"
            required
            maxlength={80}
            placeholder="Name"
          /></label
        >
        <label
          >Your feedback<Textarea
            name="body"
            required
            maxlength={2000}
            rows={3}
            placeholder="What’s working? What could be clearer?"
          ></Textarea></label
        >
        <details>
          <summary>Suggest different wording</summary><Textarea
            name="suggestion"
            aria-label="Suggested wording"
            maxlength={25000}
            rows={4}
            placeholder="Your version of this post…"
          ></Textarea>
        </details>
        {#if form?.message}<div
            class="notice"
            class:error={!form.success}
            role="status"
          >
            {form.message}
          </div>{/if}<Button variant="default" type="submit" disabled={busy}
          >{busy ? "Sending…" : "Send feedback"}<Icon
            name="arrow"
            size={14}
          /></Button
        ><span class="small muted" style="text-align:center"
          >Visible to anyone with this link.</span
        >
      </form>
    </aside>
  </div>
</main>
