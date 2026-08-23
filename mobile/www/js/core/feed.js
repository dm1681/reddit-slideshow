// The feed store: post list, cursor pagination, and optimistic actions.
// Ports the extension controller's rules:
// - prefetch when the viewer is within 5 slides of the end; dedupe by id; a
//   page with nothing new means exhausted;
// - what this session believes about posts the viewer acted on (localState,
//   keyed by Reddit fullname) outranks anything a later refresh says — that
//   is what stops a background update silently reverting an accepted vote;
// - every expanded gallery image is the same Reddit post, so acting on one
//   updates all of its siblings.
const PREFETCH_MARGIN = 5;

export function createFeed(source) {
  let posts = [];
  let after = null;
  let started = false;
  let exhausted = false;
  let loading = false;
  let lastError = null;
  const localState = new Map();
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        // One listener must not silence the rest
      }
    });
  }

  function mergeLocal(list) {
    if (localState.size === 0) return list;
    return list.map((p) =>
      localState.has(p.redditId) ? { ...p, ...localState.get(p.redditId) } : p
    );
  }

  function setPostState(redditId, changes) {
    localState.set(redditId, { ...(localState.get(redditId) || {}), ...changes });
    posts = posts.map((p) => (p.redditId === redditId ? { ...p, ...changes } : p));
    notify();
  }

  async function loadNextPage() {
    if (loading || exhausted) return;
    loading = true;
    lastError = null;
    notify();
    try {
      const result = await source.page(after);
      const existing = new Set(posts.map((p) => p.id));
      const fresh = mergeLocal(result.posts.filter((p) => !existing.has(p.id)));
      after = result.after;
      started = true;
      if (fresh.length === 0 && !after) {
        exhausted = true;
      } else {
        posts = posts.concat(fresh);
        if (!after) exhausted = true;
      }
    } catch (e) {
      lastError = e;
      // A failed page is "not yet", not "never" — unless nothing ever loaded,
      // in which case the caller decides (e.g. fall back to the demo source).
      if (!started) throw e;
    } finally {
      loading = false;
      notify();
    }
  }

  return {
    get posts() {
      return posts;
    },
    get exhausted() {
      return exhausted;
    },
    get loading() {
      return loading;
    },
    get lastError() {
      return lastError;
    },
    source,

    onUpdate(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async start() {
      await loadNextPage();
    },

    // Called on every slide change; refills when the viewer runs near the end.
    ensure(index) {
      if (index >= posts.length - PREFETCH_MARGIN && !exhausted && !loading) {
        loadNextPage().catch(() => {
          // surfaced via lastError; the pager retries while waiting
        });
      }
    },

    // Optimistic with rollback: the button moves now and moves back with an
    // error only if the source refuses.
    async toggleSave(post) {
      if (!post || !post.redditId) return { error: "No post" };
      const saved = !post.saved;
      setPostState(post.redditId, { saved });
      const result = await source
        .save(post.redditId, saved)
        .catch(() => ({ error: "Could not reach the source" }));
      if (!result || result.error) {
        setPostState(post.redditId, { saved: !saved });
        return { error: (result && result.error) || "Save failed" };
      }
      return { success: true };
    },

    // Pressing the same arrow again takes the vote back, as Reddit's own
    // buttons do.
    async vote(post, dir) {
      if (!post || !post.redditId) return { error: "No post" };
      const previous = post.likes === undefined ? null : post.likes;
      const wanted = dir === 1;
      const next = previous === wanted ? null : wanted;
      const sentDir = next === null ? 0 : next ? 1 : -1;
      setPostState(post.redditId, { likes: next });
      const result = await source
        .vote(post.redditId, sentDir)
        .catch(() => ({ error: "Could not reach the source" }));
      if (!result || result.error) {
        setPostState(post.redditId, { likes: previous });
        return { error: (result && result.error) || "Vote failed" };
      }
      return { success: true };
    },
  };
}
