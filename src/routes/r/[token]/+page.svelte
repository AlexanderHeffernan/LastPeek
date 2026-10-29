<script lang="ts">
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
    >Your own little space<Icon name="arrow" size={12} /></a
  >
</header>
<main class="workspace">
  <div class="workspace-toolbar">
    <span class="breadcrumb">A friend would love your thoughts.</span>
    <div class="row">
      <span class="badge green">Unpublished</span><label class="small muted"
        >Version<select
          aria-label="Review version"
          style="display:inline-block;margin:0 0 0 8px;padding:5px 8px;font-size:11px;width:auto"
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
          <span class="eyebrow">A second pair of eyes</span><span class="badge"
            >Version {data.revision}</span
          >
        </div>
        <PostPreview
          content={data.content}
          media={data.media}
          token={data.token}
        />
      </div>
      <p class="footer-note">
        Just a thought between friends.<br />Please keep this draft and its
        review link to yourself.
      </p>
    </section>
    <aside class="feedback-column" aria-label="Feedback">
      <div class="feedback-heading">
        <h2>What do you think?</h2>
        <p>A thought, a tweak, a little encouragement.</p>
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
        <h3 style="margin:0">Leave a thought.</h3>
        <input type="hidden" name="revision" value={data.revision} />
        <label
          >On which post?<select name="postId" aria-label="Feedback post"
            >{#each data.content.posts as post, index}<option value={post.id}
                >Post {index + 1}: {post.text.slice(0, 20) || "Media post"}{post
                  .text.length > 20
                  ? "…"
                  : ""}</option
              >{/each}</select
          ></label
        >
        <label
          >Your name<input
            name="name"
            autocomplete="given-name"
            required
            maxlength="80"
            placeholder="Just your first name is fine"
          /></label
        >
        <label
          >Your feedback<textarea
            name="body"
            required
            maxlength="2000"
            rows="3"
            placeholder="What’s working? What could be clearer?"
          ></textarea></label
        >
        <details>
          <summary
            >Suggest different wording <span class="muted">(optional)</span
            ></summary
          ><textarea
            name="suggestion"
            aria-label="Suggested wording"
            maxlength="25000"
            rows="4"
            placeholder="Your version of this post…"></textarea>
        </details>
        {#if form?.message}<div
            class="notice"
            class:error={!form.success}
            role="status"
          >
            {form.message}
          </div>{/if}<button class="primary" disabled={busy}
          >{busy ? "Sending…" : "Send feedback"}<Icon
            name="arrow"
            size={14}
          /></button
        ><span class="small muted" style="font-size:10px;text-align:center"
          >No account needed. Names aren’t verified.<br />Feedback is visible to
          anyone with this link.</span
        >
      </form>
      <p class="footer-note">
        Something of your own to share?<br /><a href="/login">Meet LastPeek →</a
        ><br /><span style="font-size:10px"
          >Invite-only while we find our feet.</span
        >
      </p>
    </aside>
  </div>
</main>
