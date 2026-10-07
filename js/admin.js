import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SNACK_VAULT_CONFIG;

const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

const $ = id => document.getElementById(id);

let creator = null;
let snacks = [];


// ======================================================
// HELPERS
// ======================================================

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
  );
}

function setLoginMessage(message) {
  $("loginMsg").textContent = message || "";
}

function setSaveMessage(message) {
  $("saveMsg").textContent = message || "";

  if (message) {
    setTimeout(() => {
      $("saveMsg").textContent = "";
    }, 1800);
  }
}


// ======================================================
// CREATOR ACCOUNT CONNECTION
// ======================================================

async function connectCreatorAccount(user) {

  // First check if this account already owns a Snack Vault.
  const {
    data: existingCreator,
    error: existingError
  } = await supabase
    .from("creators")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingCreator) {
    return existingCreator;
  }


  // Otherwise securely claim Pretty's existing Snack Vault.
  const {
    data: claimedCreator,
    error: claimError
  } = await supabase.rpc(
    "claim_creator_account",
    {
      p_slug: cfg.DEFAULT_CREATOR_SLUG
    }
  );

  if (claimError) {
    throw claimError;
  }

  if (!claimedCreator) {
    throw new Error(
      "This Snack Vault could not be connected to your account."
    );
  }

  return claimedCreator;
}


// ======================================================
// LOAD DASHBOARD
// ======================================================

async function load() {

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }


  if (!user) {

    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");

    return;
  }


  try {

    creator = await connectCreatorAccount(user);

  } catch (error) {

    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");

    setLoginMessage(error.message);

    return;
  }


  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");


  $("creatorName").textContent =
    creator.name || "Snack Vault";

  $("setName").value =
    creator.name || "";

  $("setColor").value =
    creator.accent_color || "#ff2d95";


  document.documentElement.style.setProperty(
    "--accent",
    creator.accent_color || "#ff2d95"
  );


  await refreshDashboard();
}


// ======================================================
// SIGN IN
// ======================================================

$("loginForm").addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const email =
      $("email").value.trim();

    const password =
      $("password").value;


    if (!email || !password) {
      setLoginMessage(
        "Enter your email and password."
      );
      return;
    }


    setLoginMessage("Signing in…");


    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });


    if (error) {
      setLoginMessage(error.message);
      return;
    }


    location.reload();
  }
);


// ======================================================
// CREATE ACCOUNT
// ======================================================

$("signUpButton").addEventListener(
  "click",
  async () => {

    const email =
      $("email").value.trim();

    const password =
      $("password").value;


    if (!email) {
      setLoginMessage(
        "Enter your email first."
      );
      return;
    }


    if (!password) {
      setLoginMessage(
        "Enter a password."
      );
      return;
    }


    if (password.length < 6) {
      setLoginMessage(
        "Password must be at least 6 characters."
      );
      return;
    }


    setLoginMessage(
      "Creating your account…"
    );


    const {
      data,
      error
    } = await supabase.auth.signUp({
      email,
      password
    });


    if (error) {
      setLoginMessage(error.message);
      return;
    }


    // Supabase may require email verification.
    if (!data.session) {

      setLoginMessage(
        "Account created! Check your email to confirm your account, then return here and sign in."
      );

      return;
    }


    if (!data.user) {

      setLoginMessage(
        "Account created, but the user session could not be loaded. Try signing in."
      );

      return;
    }


    setLoginMessage(
      "Account created! Connecting your Snack Vault…"
    );


    try {

      creator =
        await connectCreatorAccount(
          data.user
        );

      location.reload();

    } catch (error) {

      setLoginMessage(
        error.message
      );
    }
  }
);


// ======================================================
// LOG OUT
// ======================================================

$("logout").addEventListener(
  "click",
  async () => {

    await supabase.auth.signOut();

    location.reload();
  }
);


// ======================================================
// REFRESH DASHBOARD
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
// LOAD SNACKS
// ======================================================

async function loadSnacks() {

  const {
    data,
    error
  } = await supabase
    .from("snacks")
    .select("*")
    .eq("creator_id", creator.id)
    .order("created_at");


  if (error) {
    throw error;
  }


  snacks = data || [];

  $("snackCount").textContent =
    snacks.filter(
      snack =>
        snack.enabled &&
        !snack.archived
    ).length;


  renderSnacks();
}


// ======================================================
// LOAD STATS
// ======================================================

async function loadStats() {

  const viewerResult =
    await supabase
      .from("viewers")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "creator_id",
        creator.id
      );


  $("viewerCount").textContent =
    viewerResult.count || 0;


  const pullResult =
    await supabase
      .from("pulls")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "creator_id",
        creator.id
      );


  $("pullCount").textContent =
    pullResult.count || 0;


  const {
    data: leaderboardData
  } = await supabase
    .from("leaderboard")
    .select("unique_snacks")
    .eq(
      "creator_id",
      creator.id
    )
    .order(
      "unique_snacks",
      {
        ascending: false
      }
    )
    .limit(1);


  $("leaderCount").textContent =
    leaderboardData?.[0]
      ?.unique_snacks || 0;
}


// ======================================================
// RENDER SNACKS
// ======================================================

function renderSnacks() {

  const activeSnacks =
    snacks.filter(
      snack =>
        snack.enabled &&
        !snack.archived
    );


  const totalWeight =
    activeSnacks.reduce(
      (total, snack) =>
        total +
        Number(snack.weight || 0),
      0
    );


  const visibleSnacks =
    snacks.filter(
      snack =>
        !snack.archived
    );


  if (!visibleSnacks.length) {

    $("snackRows").innerHTML = `
      <tr>
        <td colspan="6">
          No snacks yet.
        </td>
      </tr>
    `;

    return;
  }


  $("snackRows").innerHTML =
    visibleSnacks
      .map(snack => {

        const weight =
          Number(
            snack.weight || 0
          );


        const chance =
          snack.enabled &&
          totalWeight > 0

            ? (
                (weight /
                  totalWeight) *
                100
              ).toFixed(1) + "%"

            : "—";


        return `
          <tr>

            <td>

              ${
                snack.image_url
                  ? `
                    <img
                      class="thumb"
                      src="${esc(
                        snack.image_url
                      )}"
                      alt=""
                    >
                  `
                  : ""
              }

              ${esc(snack.name)}

            </td>

            <td>
              ${esc(snack.rarity)}
            </td>

            <td>
              ${weight}
            </td>

            <td>
              ${chance}
            </td>

            <td>
              ${
                snack.enabled
                  ? "Enabled"
                  : "Disabled"
              }
            </td>

            <td>

              <button
                class="edit"
                data-edit="${snack.id}"
              >
                Edit
              </button>

            </td>

          </tr>
        `;
      })
      .join("");


  document
    .querySelectorAll(
      "[data-edit]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const snack =
            snacks.find(
              item =>
                item.id ===
                button.dataset.edit
            );

          if (snack) {
            openSnackModal(snack);
          }
        }
      );
    });
}


// ======================================================
// PULL HISTORY
// ======================================================

async function loadPullHistory() {

  const {
    data,
    error
  } = await supabase
    .from("pulls")
    .select(
      "created_at,viewers(display_name),snacks(name)"
    )
    .eq(
      "creator_id",
      creator.id
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    )
    .limit(50);


  if (error) {

    $("pullRows").innerHTML = `
      <tr>
        <td colspan="3">
          No history yet.
        </td>
      </tr>
    `;

    return;
  }


  if (!data?.length) {

    $("pullRows").innerHTML = `
      <tr>
        <td colspan="3">
          No pulls yet.
        </td>
      </tr>
    `;

    return;
  }


  $("pullRows").innerHTML =
    data
      .map(pull => `
        <tr>

          <td>
            ${esc(
              pull.viewers
                ?.display_name
            )}
          </td>

          <td>
            ${esc(
              pull.snacks?.name
            )}
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
    cfg.SUPABASE_URL.replace(
      /\/$/,
      ""
    ) +
    "/functions/v1/pull";
}


// ======================================================
// SNACK MODAL
// ======================================================

function openSnackModal(
  snack = null
) {

  $("modal").classList.remove(
    "hidden"
  );


  $("snackId").value =
    snack?.id || "";


  $("modalTitle").textContent =
    snack
      ? "Edit Snack"
      : "Add Snack";


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


  $("archiveSnack")
    .classList
    .toggle(
      "hidden",
      !snack
    );
}


function closeSnackModal() {

  $("modal").classList.add(
    "hidden"
  );

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

$("snackForm").addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    const snackId =
      $("snackId").value;


    const existingSnack =
      snacks.find(
        snack =>
          snack.id === snackId
      );


    let imageUrl =
      existingSnack?.image_url ||
      null;


    const file =
      $("sImage").files[0];


    // Upload a new image if selected.
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
        .upload(
          path,
          file
        );


      if (uploadError) {

        alert(
          uploadError.message
        );

        return;
      }


      imageUrl =
        supabase.storage
          .from("snack-images")
          .getPublicUrl(path)
          .data
          .publicUrl;
    }


    const row = {

      creator_id:
        creator.id,

      name:
        $("sName")
          .value
          .trim(),

      description:
        $("sDesc")
          .value
          .trim(),

      rarity:
        $("sRarity").value,

      category:
        $("sCategory")
          .value
          .trim(),

      weight:
        Number(
          $("sWeight").value
        ),

      enabled:
        $("sEnabled").checked
    };


    if (imageUrl) {
      row.image_url =
        imageUrl;
    }


    let result;


    if (snackId) {

      result =
        await supabase
          .from("snacks")
          .update(row)
          .eq(
            "id",
            snackId
          )
          .eq(
            "creator_id",
            creator.id
          );

    } else {

      result =
        await supabase
          .from("snacks")
          .insert(row);
    }


    if (result.error) {

      alert(
        result.error.message
      );

      return;
    }


    closeSnackModal();

    await refreshDashboard();
  }
);


// ======================================================
// ARCHIVE SNACK
// ======================================================

$("archiveSnack").addEventListener(
  "click",
  async () => {

    const snackId =
      $("snackId").value;


    if (!snackId) {
      return;
    }


    const confirmed =
      confirm(
        "Archive this snack? Existing viewer copies and pull history stay intact."
      );


    if (!confirmed) {
      return;
    }


    const {
      error
    } = await supabase
      .from("snacks")
      .update({
        archived: true,
        enabled: false
      })
      .eq(
        "id",
        snackId
      )
      .eq(
        "creator_id",
        creator.id
      );


    if (error) {

      alert(
        error.message
      );

      return;
    }


    closeSnackModal();

    await refreshDashboard();
  }
);


// ======================================================
// GENERATE BOT API KEY
// ======================================================

$("generateKey").addEventListener(
  "click",
  async () => {

    if (!creator) {
      return;
    }


    const confirmed =
      confirm(
        "Generate a new bot key? Any old active key will stop working."
      );


    if (!confirmed) {
      return;
    }


    const {
      data,
      error
    } = await supabase.rpc(
      "generate_api_key",
      {
        p_creator_id:
          creator.id
      }
    );


    if (error) {

      alert(
        error.message
      );

      return;
    }


    $("apiKey").value =
      data;


    $("keyWarning")
      .classList
      .remove("hidden");
  }
);


// ======================================================
// COPY ENDPOINT
// ======================================================

document
  .querySelector(
    '[data-copy="endpoint"]'
  )
  .addEventListener(
    "click",
    async () => {

      try {

        await navigator.clipboard
          .writeText(
            $("endpoint").value
          );

        setSaveMessage(
          "Endpoint copied"
        );

      } catch {

        alert(
          "Could not copy automatically. Select the endpoint and copy it manually."
        );
      }
    }
  );


// ======================================================
// SETTINGS
// ======================================================

$("saveSettings").addEventListener(
  "click",
  async () => {

    const name =
      $("setName")
        .value
        .trim();


    const accentColor =
      $("setColor").value;


    if (!name) {

      alert(
        "Creator name cannot be empty."
      );

      return;
    }


    const {
      data,
      error
    } = await supabase
      .from("creators")
      .update({
        name,
        accent_color:
          accentColor
      })
      .eq(
        "id",
        creator.id
      )
      .select()
      .single();


    if (error) {

      alert(
        error.message
      );

      return;
    }


    creator = data;


    $("creatorName").textContent =
      creator.name;


    document.documentElement
      .style
      .setProperty(
        "--accent",
        creator.accent_color ||
          "#ff2d95"
      );


    setSaveMessage("Saved");
  }
);


// ======================================================
// AUTH STATE CHANGES
// ======================================================

supabase.auth.onAuthStateChange(
  (event, session) => {

    if (
      event === "SIGNED_OUT"
    ) {

      creator = null;
      snacks = [];

      $("app").classList.add(
        "hidden"
      );

      $("login").classList.remove(
        "hidden"
      );
    }
  }
);


// ======================================================
// START
// ======================================================

load().catch(error => {

  console.error(error);

  $("login").classList.remove(
    "hidden"
  );

  $("app").classList.add(
    "hidden"
  );

  setLoginMessage(
    error.message ||
      "Something went wrong loading the dashboard."
  );
});
