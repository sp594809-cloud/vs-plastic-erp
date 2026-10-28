"use strict";
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/service-worker.js").catch(() => {}),
  );
const address = document.getElementById("saved-address");
if (address)
  address.addEventListener("change", () => {
    if (address.value)
      document.getElementById("delivery-address").value = address.value;
  });
document.querySelectorAll("form").forEach((form) =>
  form.addEventListener("submit", () => {
    const button = form.querySelector(
      'button[type="submit"],button:not([type])',
    );
    if (button) {
      button.disabled = true;
      setTimeout(() => (button.disabled = false), 8000);
    }
  }),
);

const upload = document.getElementById("image-upload");
if (upload)
  upload.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = document.getElementById("upload-result");
    const file = upload.querySelector("input[type=file]").files[0];
    if (!file || file.size > 2 * 1024 * 1024) {
      result.textContent = "Choose an image smaller than 2 MB.";
      return;
    }
    result.textContent = "Uploading…";
    try {
      const response = await fetch(
        "/admin/products/" + upload.dataset.product + "/image",
        {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-CSRF-Token": upload.dataset.csrf,
          },
          body: file,
        },
      );
      if (!response.ok)
        throw new Error(
          "Upload failed. Check the file type and size, then reload and retry.",
        );
      window.location.reload();
    } catch (error) {
      result.textContent = error.message;
    }
  });
