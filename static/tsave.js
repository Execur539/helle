
  document.addEventListener("DOMContentLoaded", () => {
    const themeToggle = document.querySelector(".theme-controller");

    // Check local storage for the saved state
    const savedTheme = localStorage.getItem("themeToggle");

    if (savedTheme === "on") {
      themeToggle.checked = true; // Turn the switch on
      applyTheme("on");
    } else {
      themeToggle.checked = false; // Turn the switch off
      applyTheme("off");
    }

    // Add event listener to save state on toggle
    themeToggle.addEventListener("change", () => {
      const state = themeToggle.checked ? "on" : "off";
      localStorage.setItem("themeToggle", state);
      applyTheme(state);
    });

    function applyTheme(state) {
      if (state === "on") {
        document.documentElement.setAttribute("data-theme", "synthwave");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
  });
