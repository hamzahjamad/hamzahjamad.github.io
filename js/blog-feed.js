(function () {
  "use strict";

  function stripHtml(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    return doc.body.textContent || "";
  }

  function truncate(text, max) {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    const head = lastSpace > Math.floor(max * 0.5) ? cut.slice(0, lastSpace) : cut;
    return head.trimEnd() + "…";
  }

  function formatDate(isoOrRfc) {
    const d = new Date(isoOrRfc);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeHref(url) {
    if (url == null) return "";
    const s = String(url).trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (e) {
      return "";
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadFromBlogRest(apiBase, limit) {
    const url =
      apiBase.replace(/\/$/, "") +
      "?per_page=" +
      encodeURIComponent(String(limit)) +
      "&orderby=date&order=desc&_embed=0";
    const posts = await fetchJson(url);
    if (!Array.isArray(posts)) throw new Error("Unexpected blog API response");
    return posts.map(function (post) {
      const title =
        post.title && typeof post.title.rendered === "string"
          ? stripHtml(post.title.rendered)
          : stripHtml(post.title || "");
      const rawExcerpt =
        post.excerpt && typeof post.excerpt.rendered === "string"
          ? post.excerpt.rendered
          : "";
      return {
        title: title || "Untitled",
        link: post.link || "#",
        date: post.date || "",
        excerptText: stripHtml(rawExcerpt),
      };
    });
  }

  async function loadFromRss2Json(rssUrl, apiKey, limit) {
    let endpoint =
      "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(rssUrl);
    if (apiKey) endpoint += "&api_key=" + encodeURIComponent(apiKey);
    const data = await fetchJson(endpoint);
    if (data.status !== "ok") {
      throw new Error(data.message || "RSS feed could not be read");
    }
    const items = Array.isArray(data.items) ? data.items : [];
    return items.slice(0, limit).map(function (item) {
      return {
        title: item.title || "Untitled",
        link: item.link || "#",
        date: item.pubDate || "",
        excerptText: stripHtml(item.description || item.content || ""),
      };
    });
  }

  function render(root, posts, excerptMax, blogUrl) {
    const section = document.getElementById("latest-posts");
    if (section) section.setAttribute("aria-busy", "false");

    const home = safeHref(blogUrl) || "#";

    if (!posts.length) {
      root.innerHTML =
        '<p class="blog-feed__error">No posts were returned. <a href="' +
        escapeHtml(home) +
        '">Visit the blog</a>.</p>';
      return;
    }

    const itemsHtml = posts
      .map(function (post) {
        const excerpt = escapeHtml(truncate(post.excerptText, excerptMax));
        const when = escapeHtml(formatDate(post.date));
        const title = escapeHtml(post.title);
        const href = safeHref(post.link) || home;
        return (
          '<li class="blog-feed__item">' +
          (when ? '<p class="blog-feed__meta">' + when + "</p>" : "") +
          '<h3 class="blog-feed__title"><a href="' +
          escapeHtml(href) +
          '" rel="noopener noreferrer">' +
          title +
          "</a></h3>" +
          (excerpt
            ? '<p class="blog-feed__excerpt">' + excerpt + "</p>"
            : '<p class="blog-feed__excerpt">No excerpt available.</p>') +
          '<a class="blog-feed__read" href="' +
          escapeHtml(href) +
          '" rel="noopener noreferrer">Read post <span aria-hidden="true">→</span></a>' +
          "</li>"
        );
      })
      .join("");

    const footerHref = safeHref(blogUrl) || home;

    root.innerHTML =
      '<ul class="blog-feed__list">' +
      itemsHtml +
      '</ul><p class="blog-feed__footer"><a href="' +
      escapeHtml(footerHref) +
      '" rel="noopener noreferrer">View all posts on the blog</a></p>';
  }

  function renderError(root, blogUrl, detail) {
    const section = document.getElementById("latest-posts");
    if (section) section.setAttribute("aria-busy", "false");
    const href = safeHref(blogUrl) || "#";
    root.innerHTML =
      '<p class="blog-feed__error">Could not load recent posts' +
      (detail ? " (" + escapeHtml(detail) + ")" : "") +
      '. <a href="' +
      escapeHtml(href) +
      '">Open the blog</a> or try again later.</p>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    const root = document.getElementById("blog-feed");
    if (!root || !root.dataset) return;

    const rssUrl = root.dataset.rssUrl || "";
    const wpJson = root.dataset.wpJson || "";
    const limit = Math.min(20, Math.max(1, parseInt(root.dataset.limit || "5", 10) || 5));
    const excerptMax = Math.min(600, Math.max(80, parseInt(root.dataset.excerptMax || "220", 10) || 220));
    const apiKey = root.dataset.rss2jsonKey || "";
    let blogUrl = "";
    if (wpJson) blogUrl = wpJson.replace(/\/wp-json\/wp\/v2\/posts\/?$/, "");
    if (!blogUrl && rssUrl) blogUrl = rssUrl.replace(/\/feed\/?$/i, "");

    if (!rssUrl && !wpJson) {
      renderError(root, blogUrl || "#", "Missing feed configuration");
      return;
    }

    (async function () {
      try {
        if (wpJson) {
          try {
            const posts = await loadFromBlogRest(wpJson, limit);
            render(root, posts, excerptMax, blogUrl);
            return;
          } catch (e) {
            /* continue to RSS */
          }
        }
        if (!rssUrl) throw new Error("No RSS URL");
        const posts = await loadFromRss2Json(rssUrl, apiKey, limit);
        render(root, posts, excerptMax, blogUrl);
      } catch (err) {
        renderError(root, blogUrl, err && err.message ? err.message : "");
      }
    })();
  });
})();
