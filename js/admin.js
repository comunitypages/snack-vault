import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SNACK_VAULT_CONFIG;

const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

const $ = x => document.getElementById(x);

let c = null;
let items = [];

const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    m =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[m]
  );


// ======================================================
// ACCOUNT / CREATOR SETUP
// ======================================================

async function connectPrettyAccount(user) {

  // First see if this account already owns a creator.
  const { data: ownedCreator, error: ownedError } = await supabase
    .from("creators")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (ownedError) throw ownedError;

  if (ownedCreator) {
    return ownedCreator;
  }


  // Otherwise find Pretty's existing Snack Vault.
  const { data: pretty, error: prettyError } = await supabase
    .from("creators")
    .select("*")
    .eq("slug", cfg.DEFAULT_CREATOR_SLUG)
    .maybeSingle();

  if (prettyError) throw prettyError;

  if (!pretty) {
    throw new Error("Pretty Massacure's Snack Vault could not be found.");
  }


  // If someone already owns it, this account must not claim it.
  if (pretty.owner_id && pretty.owner_id !== user.id) {
    throw new Error(
      "This Snack Vault is already connected to another creator account."
    );
  }


  // Claim the existing Pretty creator.
  const { data: claimed, error: claimError } = await supabase
    .from("creators")
    .update({
      owner_id: user.id
    })
    .eq("id", pretty.id)
    .is("owner_id", null)
    .select()
    .maybeSingle();

  if (claimError) throw claimError;


  // If the row was not returned, check whether we already own it.
  if (!claimed) {

    const { data: check, error: checkError } = await supabase
      .from("creators")
      .select("*")
      .eq("id", pretty.id)
      .maybeSingle();

    if (checkError) throw checkError;

    if (check?.owner_id === user.id) {
      return check;
    }

    throw new Error(
      "This Snack Vault could not be connected to your account."
    );
  }

  return claimed;
}


// ======================================================
// LOAD DASHBOARD
// ======================================================

async function load() {

  const {
    data: { user }
  } = await supabase.auth.getUser();


  if (!user) {
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }


  try {

    c = await connectPrettyAccount(user);

  } catch (error) {

    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");

    $("loginMsg").textContent = error.message;

    return;
  }


  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");

  $("creatorName").textContent = c.name;

  $("setName").value = c.name;

  $("setColor").value =
    c.accent_color || "#ff2d95";

  document.documentElement.style.setProperty(
    "--accent",
    c.accent_color || "#ff2d95"
  );

  await refresh();
}


// ======================================================
// SIGN IN
// ======================================================

$("loginForm").onsubmit = async e => {

  e.preventDefault();

  $("loginMsg").textContent = "Signing in…";


  const { error } =
    await supabase.auth.signInWithPassword({

      email: $("email").value.trim(),

      password: $("password").value

    });


  if (error) {

    $("loginMsg").textContent =
      error.message;

    return;
  }


  location.reload();
};


// ======================================================
// CREATE ACCOUNT
// ======================================================

$("signUpButton").onclick = async () => {

  const email =
    $("email").value.trim();

  const password =
    $("password").value;


  if (!email) {

    $("loginMsg").textContent =
      "Enter your email first.";

    return;
  }


  if (password.length < 6) {

    $("loginMsg").textContent =
      "Password must be at least 6 characters.";

    return;
  }


  $("loginMsg").textContent =
    "Creating your account…";


  const {
    data,
    error
  } = await supabase.auth.signUp({

    email,

    password

  });


  if (error) {

    $("loginMsg").textContent =
      error.message;

    return;
  }


  // If Supabase requires email confirmation.
  if (!data.session) {

    $("loginMsg").textContent =
      "Account created! Check your email to confirm it, then come back and sign in.";

    return;
  }


  $("loginMsg").textContent =
    "Account created! Connecting your Snack Vault…";


  try {

    await connectPrettyAccount(data.user);

    location.reload();

  } catch (error) {

    $("loginMsg").textContent =
      error.message;
  }
};


// ======================================================
// LOG OUT
// ======================================================

$("logout").onclick = async () => {

  await supabase.auth.signOut();

  location.reload();
};


// ======================================================
// DASHBOARD DATA
// ======================================================

async function refresh() {

  let { data, error } =
    await supabase
      .from("snacks")
      .select("*")
      .eq("creator_id", c.id)
      .order("created_at");


  if (error) throw error;


  items = data || [];


  $("snackCount").textContent =
    items.filter(
      x => x.enabled && !x.archived
    ).length;


  let { count: v } =
    await supabase
      .from("viewers")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("creator_id", c.id);


  $("viewerCount").textContent =
    v || 0;


  let { count: p } =
    await supabase
      .from("pulls")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("creator_id", c.id);


  $("pullCount").textContent =
    p || 0;


  let { data: l } =
    await supabase
      .from("leaderboard")
      .select("unique_snacks")
      .eq("creator_id", c.id)
      .order("unique_snacks", {
        ascending: false
      })
      .limit(1);


  $("leaderCount").textContent =
    l?.[0]?.unique_snacks || 0;


  render();

  await pulls();

  endpoint();
}


// ======================================================
// SNACK TABLE
// ======================================================

function render() {

  let active =
    items.filter(
      x => x.enabled && !x.archived
    );


  let tw =
    active.reduce(
      (a, x) => a + x.weight,
      0
    );


  $("snackRows").innerHTML =
    items
      .filter(x => !x.archived)
      .map(
        x => `

<tr>

<td>

${x.image_url
  ? `<img class="thumb" src="${esc(x.image_url)}">`
  : ""}

${esc(x.name)}

</td>

<td>${esc(x.rarity)}</td>

<td>${x.weight}</td>

<td>

${
  x.enabled && tw
    ? ((x.weight / tw) * 100).toFixed(1) + "%"
    : "—"
}

</td>

<td>
${x.enabled ? "Enabled" : "Disabled"}
</td>

<td>

<button
class="edit"
data-edit="${x.id}">
Edit
</button>

</td>

</tr>

`
      )
      .join("");


  document
    .querySelectorAll("[data-edit]")
    .forEach(
      b =>
        (b.onclick = () =>
          open(
            items.find(
              x =>
                x.id ===
                b.dataset.edit
            )
          ))
    );
}


// ======================================================
// PULL HISTORY
// ======================================================

async function pulls() {

  let { data, error } =
    await supabase
      .from("pulls")
      .select(
        "created_at,viewers(display_name),snacks(name)"
      )
      .eq("creator_id", c.id)
      .order("created_at", {
        ascending: false
      })
      .limit(50);


  if (error) {

    $("pullRows").innerHTML =
      '<tr><td colspan="3">No history yet.</td></tr>';

    return;
  }


  $("pullRows").innerHTML =
    (data || [])
      .map(
        x => `

<tr>

<td>
${esc(x.viewers?.display_name)}
</td>

<td>
${esc(x.snacks?.name)}
</td>

<td>
${new Date(
  x.created_at
).toLocaleString()}
</td>

</tr>

`
      )
      .join("") ||

    '<tr><td colspan="3">No pulls yet.</td></tr>';
}


// ======================================================
// BOT ENDPOINT
// ======================================================

function endpoint() {

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

function open(x = null) {

  $("modal").classList.remove(
    "hidden"
  );

  $("snackId").value =
    x?.id || "";

  $("modalTitle").textContent =
    x ? "Edit Snack" : "Add Snack";

  $("sName").value =
    x?.name || "";

  $("sDesc").value =
    x?.description || "";

  $("sRarity").value =
    x?.rarity || "Common";

  $("sCategory").value =
    x?.category || "Snack";

  $("sWeight").value =
    x?.weight ?? 50;

  $("sEnabled").checked =
    x?.enabled ?? true;

  $("archiveSnack").classList.toggle(
    "hidden",
    !x
  );
}


function close() {

  $("modal").classList.add(
    "hidden"
  );

  $("snackForm").reset();
}


$("addSnack").onclick =
  () => open();


$("closeModal").onclick =
$("cancelSnack").onclick =
  close;


// ======================================================
// SAVE SNACK
// ======================================================

$("snackForm").onsubmit =
async e => {

  e.preventDefault();


  let id =
    $("snackId").value;


  let img = null;


  let file =
    $("sImage").files[0];


  if (file) {

    let path =
      `${c.id}/${crypto.randomUUID()}-${file.name.replace(
        /[^a-z0-9._-]/gi,
        "_"
      )}`;


    let { error } =
      await supabase.storage
        .from("snack-images")
        .upload(path, file);


    if (error)
      return alert(
        error.message
      );


    img =
      supabase.storage
        .from("snack-images")
        .getPublicUrl(path)
        .data.publicUrl;
  }


  let row = {

    creator_id: c.id,

    name:
      $("sName").value.trim(),

    description:
      $("sDesc").value.trim(),

    rarity:
      $("sRarity").value,

    category:
      $("sCategory").value.trim(),

    weight:
      Number(
        $("sWeight").value
      ),

    enabled:
      $("sEnabled").checked
  };


  if (img)
    row.image_url = img;


  let q =
    id

      ? supabase
          .from("snacks")
          .update(row)
          .eq("id", id)

      : supabase
          .from("snacks")
          .insert(row);


  let { error } = await q;


  if (error)
    return alert(
      error.message
    );


  close();

  await refresh();
};


// ======================================================
// ARCHIVE
// ======================================================

$("archiveSnack").onclick =
async () => {

  let id =
    $("snackId").value;


  if (
    !id ||
    !confirm(
      "Archive this snack? Existing viewer copies and pull history stay intact."
    )
  )
    return;


  let { error } =
    await supabase
      .from("snacks")
      .update({
        archived: true,
        enabled: false
      })
      .eq("id", id);


  if (error)
    return alert(
      error.message
    );


  close();

  await refresh();
};


// ======================================================
// BOT API KEY
// ======================================================

$("generateKey").onclick =
async () => {

  if (
    !confirm(
      "Generate a new bot key? Any old active key will stop working."
    )
  )
    return;


  let { data, error } =
    await supabase.rpc(
      "generate_api_key",
      {
        p_creator_id: c.id
      }
    );


  if (error)
    return alert(
      error.message
    );


  $("apiKey").value =
    data;


  $("keyWarning")
    .classList
    .remove("hidden");
};


document.querySelector(
  '[data-copy="endpoint"]'
).onclick =
  () =>
    navigator.clipboard.writeText(
      $("endpoint").value
    );


// ======================================================
// SETTINGS
// ======================================================

$("saveSettings").onclick =
async () => {

  let row = {

    name:
      $("setName")
        .value
        .trim(),

    accent_color:
      $("setColor").value
  };


  let { error } =
    await supabase
      .from("creators")
      .update(row)
      .eq("id", c.id);


  if (error)
    return alert(
      error.message
    );


  $("saveMsg").textContent =
    "Saved";


  c = {
    ...c,
    ...row
  };


  $("creatorName").textContent =
    c.name;


  document.documentElement
    .style
    .setProperty(
      "--accent",
      row.accent_color
    );


  setTimeout(
    () =>
      ($("saveMsg").textContent =
        ""),
    1500
  );
};


// ======================================================
// START
// ======================================================

load().catch(error => {

  $("loginMsg").textContent =
    error.message;

  console.error(error);
});
