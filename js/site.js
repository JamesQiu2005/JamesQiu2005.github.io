/* 邱瀚泽 · portfolio. Small, dependency-free, and optional: every page reads
   correctly with this file missing. */
(function () {
  "use strict";

  var doc = document;

  /* Before / after. The range input gives keyboard and screen-reader access;
     pointer events make the whole picture draggable (iOS only moves a range
     when the thumb itself is touched). ----------------------------------- */
  doc.querySelectorAll(".compare-stage").forEach(function (stage) {
    var range = stage.querySelector(".compare-range");
    function set(pct) {
      pct = Math.max(0, Math.min(100, pct));
      stage.style.setProperty("--pos", pct + "%");
      if (range && Number(range.value) !== Math.round(pct)) range.value = String(Math.round(pct));
    }
    function fromEvent(e) {
      var r = stage.getBoundingClientRect();
      set(((e.clientX - r.left) / r.width) * 100);
    }
    var dragging = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (err) {}
      fromEvent(e);
    });
    stage.addEventListener("pointermove", function (e) {
      if (dragging) fromEvent(e);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (n) {
      stage.addEventListener(n, function () {
        dragging = false;
      });
    });
    if (range) {
      range.addEventListener("input", function () {
        set(Number(range.value));
      });
    }
  });

  /* Chart tooltips: hover and keyboard focus show the same readout. Every
     value is also in the table under the chart. --------------------------- */
  var marks = doc.querySelectorAll("[data-tip]");
  if (marks.length) {
    var tip = doc.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "status");
    doc.body.appendChild(tip);
    var show = function (el) {
      var parts = el.getAttribute("data-tip").split("|");
      tip.textContent = "";
      var b = doc.createElement("b");
      b.textContent = parts[0];
      tip.appendChild(b);
      if (parts[1]) tip.appendChild(doc.createTextNode(parts[1]));
      tip.classList.add("on");
      var r = (el.querySelector("i") || el).getBoundingClientRect(); /* a bar's fill, or the dot */
      var w = tip.offsetWidth;
      var h = tip.offsetHeight;
      var x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      var y = r.top - h - 8;
      if (y < 8) y = r.bottom + 8;
      tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    };
    var hide = function () {
      tip.classList.remove("on");
    };
    marks.forEach(function (el) {
      el.addEventListener("pointerenter", function () {
        show(el);
      });
      el.addEventListener("pointerleave", hide);
      el.addEventListener("focus", function () {
        show(el);
      });
      el.addEventListener("blur", hide);
    });
    window.addEventListener("scroll", hide, { passive: true });
  }

  /* Section highlight in the top bar. ------------------------------------- */
  var links = Array.prototype.slice.call(doc.querySelectorAll('.top__links a[href^="#"]'));
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) {
      byId[a.getAttribute("href").slice(1)] = a;
    });
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) {
            a.removeAttribute("aria-current");
          });
          var a = byId[en.target.id];
          if (a) a.setAttribute("aria-current", "true");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    Object.keys(byId).forEach(function (id) {
      var s = doc.getElementById(id);
      if (s) io.observe(s);
    });
    /* The masthead has no link of its own: while it is in view, nothing is current. */
    var mast = doc.getElementById("top");
    if (mast) io.observe(mast);
  }

  /* The light table in the Imaging section. three.js and js/lighttable.js load only when the
     section is about 600 px away. If WebGL 2 is not there, or the files do not arrive, mount()
     changes nothing and the gallery in the page stays. */
  var table = doc.querySelector("[data-lighttable]");
  if (table) {
    var loadTable = function () {
      import("./lighttable.js")
        .then(function (m) {
          return m.mount(table);
        })
        .catch(function () {});
    };
    if ("IntersectionObserver" in window) {
      var near = new IntersectionObserver(
        function (entries) {
          var isNear = entries.some(function (en) {
            return en.isIntersecting;
          });
          if (!isNear) return;
          near.disconnect();
          loadTable();
        },
        { rootMargin: "600px 0px" }
      );
      near.observe(table.closest("section") || table);
    } else {
      loadTable();
    }
  }

  /* Live stars, forks and downloads. The page ships with the numbers as of its
     last edit; if GitHub answers quickly, show the current ones and today's
     date. Never lower than shipped.
     Downloads are every GitHub Release asset's count plus the iPhone beta's
     TestFlight testers, one download each. GitHub does not know the testers:
     the number is set by hand here, and the labels in index.html and
     work/spektralab.html say it too. */
  var TESTFLIGHT_TESTERS = 328;
  var REPO = "https://api.github.com/repos/JamesQiu2005/SpektraLab";

  var fromGitHub = function (url, use) {
    var ctl = "AbortController" in window ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
    }, 4000);
    fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        clearTimeout(timer);
        if (d) use(d);
      })
      .catch(function () {});
  };

  /* n goes into each [data-<key>] that shipped with no more than n, and
     today's date into the [data-<key>-date] of the same [data-live-scope]. */
  var show = function (key, n) {
    if (!n) return;
    var today = new Date();
    var stamp =
      today.getFullYear() +
      "." +
      String(today.getMonth() + 1).padStart(2, "0") +
      "." +
      String(today.getDate()).padStart(2, "0");
    doc.querySelectorAll("[data-" + key + "]").forEach(function (el) {
      if (n < Number(el.getAttribute("data-" + key))) return;
      el.textContent = n.toLocaleString("en-US");
      var scope = el.closest("[data-live-scope]") || doc;
      scope.querySelectorAll("[data-" + key + "-date]").forEach(function (d) {
        d.textContent = stamp;
      });
    });
  };

  if (window.fetch && doc.querySelector("[data-stars], [data-forks]")) {
    fromGitHub(REPO, function (d) {
      show("stars", Number(d.stargazers_count));
      show("forks", Number(d.forks_count));
    });
  }
  if (window.fetch && doc.querySelector("[data-downloads]")) {
    fromGitHub(REPO + "/releases?per_page=100", function (list) {
      if (!Array.isArray(list)) return;
      var n = 0;
      list.forEach(function (rel) {
        (rel.assets || []).forEach(function (a) {
          n += Number(a.download_count) || 0;
        });
      });
      if (n) show("downloads", n + TESTFLIGHT_TESTERS);
    });
  }
})();
