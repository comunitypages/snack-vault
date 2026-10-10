import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SNACK_VAULT_CONFIG;

const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

const $ = id => document.getElementById(id);

let creator = null;
let snacks = [];
let pendingLogoFile = null;
let removeCurrentLogo = false;


// ======================================================
// HELPERS
// ======================================================

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}

function showOnly(screen) {
  $("login").classList.add("hidden");
  $("onboarding").classList.add("hidden");
  $("app").classList.add("hidden");

  $(screen).classList.remove("hidden");
}

function loginMessage(message = "") {
  $("loginMsg").textContent = message;
}

function onboardingMessage(message = "") {
  $("onboardingMsg").textContent = message;
}

function saveMessage(message = "") {
  $("saveMsg").textContent = message;

  if (message) {
    setTimeout(() => {
      $("saveMsg").textContent = "";
    }, 1800);
  }
}

function creatorInitials(name) {
  const words = String(name || "SV")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "SV";

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return (
    words[0][0] +
    words[words.length - 1][0]
  ).toUpperCase();
}


// ======================================================
// AUTH / CREATOR LOOKUP
// ======================================================

async function getSession() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error) throw error;

  return session;
}

async function getOwnedCreator(userId) {
  const { data, error } = await supabase
    .from("creators")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data;
}


// ======================================================
// START APP
// ======================================================

async function load() {
  const session = await getSession();

  if (!session?.user) {
    creator = null;
    snacks = [];

    loginMessage("");
    showOnly("login");
    return;
  }

  creator = await getOwnedCreator(session.user.id);

  if (!creator) {
    onboardingMessage("");
    showOnly("onboarding");
    return;
  }

  await openDashboard();
}


// ======================================================
// SIGN IN
// ======================================================

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    loginMessage("Enter your email and password.");
    return;
  }

  loginMessage("Signing in…");

  const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    loginMessage(error.message);
    return;
  }

  if (!data?.session) {
    loginMessage("Could not start your login session.");
    return;
  }

  await load();
});


// ======================================================
// CREATE ACCOUNT
// ======================================================

$("signUpButton").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email) {
    loginMessage("Enter your email first.");
    return;
  }

  if (!password) {
    loginMessage("Enter a password.");
    return;
  }

  if (password.length < 6) {
    loginMessage("Password must be at least 6 characters.");
    return;
  }

  loginMessage("Creating your account…");

  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if (error) {
    loginMessage(error.message);
    return;
  }

  if (!data?.session) {
    loginMessage(
      "Account created! Check your email to confirm it, then come back and sign in."
    );
    return;
  }

  loginMessage("");

  await load();
});


// ======================================================
// CREATE NEW VAULT
// ======================================================

$("createVaultForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("newCreatorName").value.trim();

  const slug = $("newCreatorSlug")
    .value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (!name) {
    onboardingMessage("Enter your creator name.");
    return;
  }

  if (!slug) {
    onboardingMessage("Choose your Vault URL.");
    return;
  }

  onboardingMessage("Creating your Snack Vault…");

  const { data, error } = await supabase.rpc(
    "create_creator_vault",
    {
      p_slug: slug,
      p_name: name
    }
  );

  if (error) {
    onboardingMessage(error.message);
    return;
  }

  creator = data;

  if (!creator) {
    onboardingMessage(
      "Your Vault could not be created. Please try again."
    );
    return;
  }

  onboardingMessage("");

  await openDashboard();
});


// ======================================================
// CLAIM EXISTING VAULT
// ======================================================

$("claimVaultForm").addEventListener("submit", async event => {
  event.preventDefault();

  const code = $("inviteCode").value.trim();

  if (!code) {
    onboardingMessage("Enter your invite code.");
    return;
  }

  onboardingMessage("Claiming your Snack Vault…");

  const { data, error } = await supabase.rpc(
    "claim_creator_with_invite",
    {
      p_code: code
    }
  );

  if (error) {
    onboardingMessage(error.message);
    return;
  }

  creator = data;

  if (!creator) {
    onboardingMessage(
      "Your Snack Vault could not be claimed."
    );
    return;
  }

  onboardingMessage("");

  await openDashboard();
});


// ======================================================
// LOG OUT
// ======================================================

async function logout() {
  await supabase.auth.signOut();

  creator = null;
  snacks = [];

  location.reload();
}

$("logout").addEventListener("click", logout);

$("onboardingLogout").addEventListener("click", logout);


// ======================================================
// OPEN DASHBOARD
// ======================================================

async function openDashboard() {
  showOnly("app");

  $("creatorName").textContent =
    creator.name || "Snack Vault";

  $("creatorBadge").textContent =
    creatorInitials(creator.name);

  $("setName").value =
    creator.name || "";

  $("setColor").value =
    creator.accent_color || "#ff2d95";

  $("setSlug").value =
    creator.slug || "";

  pendingLogoFile = null;
  removeCurrentLogo = false;
  $("creatorLogoFile").value = "";
  $("brandingStatus").textContent = "";

  if (creator.logo_url) {
    $("creatorLogoPreview").src = creator.logo_url;
    $("creatorLogoPreview").hidden = false;
    $("creatorLogoPlaceholder").hidden = true;
    $("removeLogo").classList.remove("hidden");
  } else {
    $("creatorLogoPreview").removeAttribute("src");
    $("creatorLogoPreview").hidden = true;
    $("creatorLogoPlaceholder").hidden = false;
    $("removeLogo").classList.add("hidden");
  }

  document.documentElement.style.setProperty(
    "--accent",
    creator.accent_color || "#ff2d95"
  );

  await refreshDashboard();
}


// ======================================================
// REFRESH
// ======================================================

async function refreshDashboard() {
  await Promise.all([
    loadSnacks(),
    loadStats(),
    loadPullHistory()
  ]);

  setEndpoint();
}



// ======================================================
// SNACKS
// ======================================================

async function loadSnacks() {
  const { data, error } = await supabase
    .from("snacks")
    .select("*")
    .eq("creator_id", creator.id)
    .order("created_at");

  if (error) throw error;

  snacks = data || [];

  $("snackCount").textContent =
    snacks.filter(
      snack => snack.enabled && !snack.archived
    ).length;

  renderSnacks();
}

function renderSnacks() {
  const active = snacks.filter(
    snack => snack.enabled && !snack.archived
  );

  const totalWeight = active.reduce(
    (total, snack) =>
      total + Number(snack.weight || 0),
    0
  );

  const visible = snacks.filter(
    snack => !snack.archived
  );

  if (!visible.length) {
    $("snackRows").innerHTML = `
      <tr>
        <td colspan="6">
          No snacks yet. Add your first snack!
        </td>
      </tr>
    `;
    return;
  }

  $("snackRows").innerHTML = visible
    .map(snack => {
      const weight = Number(snack.weight || 0);

      const chance =
        snack.enabled && totalWeight > 0
          ? ((weight / totalWeight) * 100).toFixed(1) + "%"
          : "—";

      return `
        <tr>
          <td>
            ${
              snack.image_url
                ? `<img class="thumb"
                     src="${esc(snack.image_url)}"
                     alt="">`
                : ""
            }

            ${esc(snack.name)}
          </td>

          <td>${esc(snack.rarity)}</td>

          <td>${weight}</td>

          <td>${chance}</td>

          <td>
            ${snack.enabled ? "Enabled" : "Disabled"}
          </td>

          <td>
            <button
              class="edit"
              data-edit="${snack.id}">
              Edit
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  document
    .querySelectorAll("[data-edit]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const snack = snacks.find(
          item => item.id === button.dataset.edit
        );

        if (snack) {
          openSnackModal(snack);
        }
      });
    });
}


// ======================================================
// STATS
// ======================================================

async function loadStats() {
  const viewerResult = await supabase
    .from("viewers")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("creator_id", creator.id);

  $("viewerCount").textContent =
    viewerResult.count || 0;


  const pullResult = await supabase
    .from("pulls")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("creator_id", creator.id);

  $("pullCount").textContent =
    pullResult.count || 0;


  const {
    data: leaderboardData,
    error
  } = await supabase
    .from("leaderboard")
    .select("unique_snacks")
    .eq("creator_id", creator.id)
    .order("unique_snacks", {
      ascending: false
    })
    .limit(1);

  if (error) {
    console.error(error);
  }

  $("leaderCount").textContent =
    leaderboardData?.[0]?.unique_snacks || 0;
}


// ======================================================
// PULL HISTORY
// ======================================================

async function loadPullHistory() {
  const { data, error } = await supabase
    .from("pulls")
    .select(
      "created_at,viewers(display_name),snacks(name)"
    )
    .eq("creator_id", creator.id)
    .order("created_at", {
      ascending: false
    })
    .limit(50);

  if (error) {
    console.error(error);

    $("pullRows").innerHTML = `
      <tr>
        <td colspan="3">No history yet.</td>
      </tr>
    `;

    return;
  }

  if (!data?.length) {
    $("pullRows").innerHTML = `
      <tr>
        <td colspan="3">No pulls yet.</td>
      </tr>
    `;

    return;
  }

  $("pullRows").innerHTML = data
    .map(pull => `
      <tr>
        <td>
          ${esc(pull.viewers?.display_name)}
        </td>

        <td>
          ${esc(pull.snacks?.name)}
        </td>

        <td>
          ${new Date(
            pull.created_at
          ).toLocaleString()}
        </td>
      </tr>
    `)
    .join("");
}


// ======================================================
// BOT ENDPOINT
// ======================================================

function setEndpoint() {
  $("endpoint").value =
    cfg.SUPABASE_URL.replace(/\/$/, "") +
    "/functions/v1/pull";
}


// ======================================================
// SNACK MODAL
// ======================================================

function openSnackModal(snack = null) {
  $("modal").classList.remove("hidden");

  $("snackId").value =
    snack?.id || "";

  $("modalTitle").textContent =
    snack ? "Edit Snack" : "Add Snack";

  $("sName").value =
    snack?.name || "";

  $("sDesc").value =
    snack?.description || "";

  $("sRarity").value =
    snack?.rarity || "Common";

  $("sCategory").value =
    snack?.category || "Snack";

  $("sWeight").value =
    snack?.weight ?? 50;

  $("sEnabled").checked =
    snack?.enabled ?? true;

  $("sImage").value = "";

  $("archiveSnack").classList.toggle(
    "hidden",
    !snack
  );
}

function closeSnackModal() {
  $("modal").classList.add("hidden");

  $("snackForm").reset();

  $("snackId").value = "";
}

$("addSnack").addEventListener(
  "click",
  () => openSnackModal()
);

$("closeModal").addEventListener(
  "click",
  closeSnackModal
);

$("cancelSnack").addEventListener(
  "click",
  closeSnackModal
);


// ======================================================
// SAVE SNACK
// ======================================================

$("snackForm").addEventListener("submit", async event => {
  event.preventDefault();

  const snackId = $("snackId").value;

  const existingSnack = snacks.find(
    snack => snack.id === snackId
  );

  let imageUrl =
    existingSnack?.image_url || null;

  const file = $("sImage").files[0];


  if (file) {
    const safeFileName =
      file.name.replace(
        /[^a-z0-9._-]/gi,
        "_"
      );

    const path =
      `${creator.id}/${crypto.randomUUID()}-${safeFileName}`;

    const {
      error: uploadError
    } = await supabase.storage
      .from("snack-images")
      .upload(path, file);

    if (uploadError) {
      alert(uploadError.message);
      return;
    }

    imageUrl = supabase.storage
      .from("snack-images")
      .getPublicUrl(path)
      .data
      .publicUrl;
  }


  const row = {
    creator_id: creator.id,
    name: $("sName").value.trim(),
    description: $("sDesc").value.trim(),
    rarity: $("sRarity").value,
    category: $("sCategory").value.trim(),
    weight: Number($("sWeight").value),
    enabled: $("sEnabled").checked
  };


  if (imageUrl) {
    row.image_url = imageUrl;
  }


  let result;

  if (snackId) {
    result = await supabase
      .from("snacks")
      .update(row)
      .eq("id", snackId)
      .eq("creator_id", creator.id);
  } else {
    result = await supabase
      .from("snacks")
      .insert(row);
  }


  if (result.error) {
    alert(result.error.message);
    return;
  }


  closeSnackModal();

  await refreshDashboard();
});


// ======================================================
// ARCHIVE
// ======================================================

$("archiveSnack").addEventListener("click", async () => {
  const snackId = $("snackId").value;

  if (!snackId) return;

  if (
    !confirm(
      "Archive this snack? Existing viewer copies and pull history stay intact."
    )
  ) {
    return;
  }

  const { error } = await supabase
    .from("snacks")
    .update({
      archived: true,
      enabled: false
    })
    .eq("id", snackId)
    .eq("creator_id", creator.id);

  if (error) {
    alert(error.message);
    return;
  }

  closeSnackModal();

  await refreshDashboard();
});


// ======================================================
// BOT API KEY
// ======================================================

$("generateKey").addEventListener("click", async () => {
  if (!creator) return;

  if (
    !confirm(
      "Generate a new bot key? Any old active key will stop working."
    )
  ) {
    return;
  }

  const { data, error } = await supabase.rpc(
    "generate_api_key",
    {
      p_creator_id: creator.id
    }
  );

  if (error) {
    alert(error.message);
    return;
  }

  $("apiKey").value = data;

  $("keyWarning").classList.remove("hidden");
});


// ======================================================
// COPY ENDPOINT
// ======================================================

document
  .querySelector('[data-copy="endpoint"]')
  .addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        $("endpoint").value
      );

      saveMessage("Endpoint copied");
    } catch {
      alert(
        "Could not copy automatically. Copy the endpoint manually."
      );
    }
  });


// ======================================================
// COMMUNITY LOGO
// ======================================================

$("creatorLogoFile").addEventListener("change", () => {
  const file = $("creatorLogoFile").files[0];

  if (!file) return;

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    $("brandingStatus").textContent =
      "Please choose a PNG, JPG or WEBP image.";
    $("creatorLogoFile").value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    $("brandingStatus").textContent =
      "Logo must be smaller than 5 MB.";
    $("creatorLogoFile").value = "";
    return;
  }

  pendingLogoFile = file;
  removeCurrentLogo = false;

  $("creatorLogoPreview").src = URL.createObjectURL(file);
  $("creatorLogoPreview").hidden = false;
  $("creatorLogoPlaceholder").hidden = true;
  $("removeLogo").classList.remove("hidden");

  $("brandingStatus").textContent =
    "New logo selected. Click Save branding.";
});

$("removeLogo").addEventListener("click", () => {
  pendingLogoFile = null;
  removeCurrentLogo = true;
  $("creatorLogoFile").value = "";
  $("creatorLogoPreview").removeAttribute("src");
  $("creatorLogoPreview").hidden = true;
  $("creatorLogoPlaceholder").hidden = false;
  $("removeLogo").classList.add("hidden");
  $("brandingStatus").textContent =
    "Logo will be removed when you save.";
});


// ======================================================
// SETTINGS / COMMUNITY BRANDING
// ======================================================

$("saveSettings").addEventListener("click", async () => {
  if (!creator) return;

  const name = $("setName").value.trim();
  const accentColor = $("setColor").value;

  if (!name) {
    alert("Creator name cannot be empty.");
    return;
  }

  try {
    $("brandingStatus").textContent = "Saving branding…";

    let logoUrl = creator.logo_url || null;

    if (removeCurrentLogo) {
      logoUrl = null;
    }

    if (pendingLogoFile) {
      const extension =
        pendingLogoFile.type === "image/png"
          ? "png"
          : pendingLogoFile.type === "image/webp"
            ? "webp"
            : "jpg";

      const path = `${creator.id}/logo.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("creator-branding")
        .upload(path, pendingLogoFile, {
          upsert: true,
          contentType: pendingLogoFile.type,
          cacheControl: "3600"
        });

      if (uploadError) throw uploadError;

      logoUrl = supabase.storage
        .from("creator-branding")
        .getPublicUrl(path)
        .data
        .publicUrl;

      logoUrl += `?v=${Date.now()}`;
    }

    const { data, error } = await supabase
      .from("creators")
      .update({
        name,
        accent_color: accentColor,
        logo_url: logoUrl
      })
      .eq("id", creator.id)
      .select()
      .single();

    if (error) throw error;

    creator = data;

    $("creatorName").textContent = creator.name;
    $("creatorBadge").textContent = creatorInitials(creator.name);

    document.documentElement.style.setProperty(
      "--accent",
      creator.accent_color || "#ff2d95"
    );

    pendingLogoFile = null;
    removeCurrentLogo = false;
    $("creatorLogoFile").value = "";

    if (creator.logo_url) {
      $("creatorLogoPreview").src = creator.logo_url;
      $("creatorLogoPreview").hidden = false;
      $("creatorLogoPlaceholder").hidden = true;
      $("removeLogo").classList.remove("hidden");
    } else {
      $("creatorLogoPreview").removeAttribute("src");
      $("creatorLogoPreview").hidden = true;
      $("creatorLogoPlaceholder").hidden = false;
      $("removeLogo").classList.add("hidden");
    }

    $("brandingStatus").textContent = "Branding saved!";
    saveMessage("Saved");
  } catch (error) {
    console.error(error);
    $("brandingStatus").textContent =
      error.message || "Could not save branding.";
  }
});


// ======================================================
// AUTH CHANGES
// ======================================================

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    creator = null;
    snacks = [];

    showOnly("login");
  }
});


// ======================================================
// START
// ======================================================

load().catch(error => {
  console.error(error);

  showOnly("login");

  loginMessage(
    error.message ||
    "Something went wrong loading Snack Vault."
  );
});
