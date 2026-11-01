/* Zenvio booking button. Usage:
   <script src="https://gozenvio.com/widget.js" data-zenvio-host="your-link" data-label="Book now" defer></script>
   Adds a floating button that opens your Zenvio booking page in a new tab,
   tagged with source "widget". No cookies, tracking pixels or iframes. */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var host = (script.getAttribute("data-zenvio-host") || "").toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(host)) return;
  var origin = new URL(script.src).origin;
  var label = (script.getAttribute("data-label") || "Book now").slice(0, 40);
  var color = script.getAttribute("data-color") || "#365cff";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = "#365cff";
  var position = script.getAttribute("data-position") === "left" ? "left" : "right";
  var url = origin + "/book/" + host + "?src=widget";
  function mount() {
    if (document.getElementById("zenvio-booking-button")) return;
    var a = document.createElement("a");
    a.id = "zenvio-booking-button";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    a.setAttribute("aria-label", label + " (opens in a new tab)");
    var s = a.style;
    s.position = "fixed";
    s.bottom = "20px";
    s[position] = "20px";
    s.zIndex = "2147483000";
    s.padding = "13px 20px";
    s.borderRadius = "999px";
    s.background = color;
    s.color = "#fff";
    s.font = "600 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    s.textDecoration = "none";
    s.boxShadow = "0 10px 28px rgba(21,27,56,.28)";
    document.body.appendChild(a);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
