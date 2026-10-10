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



// Owner-only catalog UI; Supabase RLS remains the authority for database writes.
const OWNER_SNACK_CATALOG = [{"id":1,"name":"Doritos Nacho Cheese","rarity":"common","filename":"snack-001.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-001.png"},{"id":2,"name":"Doritos Cool Ranch","rarity":"common","filename":"snack-002.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-002.png"},{"id":3,"name":"Lay's Classic","rarity":"common","filename":"snack-003.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-003.png"},{"id":4,"name":"Lay's Sour Cream & Onion","rarity":"common","filename":"snack-004.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-004.png"},{"id":5,"name":"Cheetos Crunchy","rarity":"common","filename":"snack-005.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-005.png"},{"id":6,"name":"Cheetos Puffs","rarity":"common","filename":"snack-006.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-006.png"},{"id":7,"name":"Fritos Original","rarity":"common","filename":"snack-007.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-007.png"},{"id":8,"name":"Ruffles Original","rarity":"common","filename":"snack-008.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-008.png"},{"id":9,"name":"Pringles Original","rarity":"common","filename":"snack-009.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-009.png"},{"id":10,"name":"Pringles Sour Cream & Onion","rarity":"common","filename":"snack-010.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-010.png"},{"id":11,"name":"Tostitos Scoops","rarity":"common","filename":"snack-011.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-011.png"},{"id":12,"name":"SunChips Harvest Cheddar","rarity":"common","filename":"snack-012.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-012.png"},{"id":13,"name":"Funyuns Original","rarity":"common","filename":"snack-013.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-013.png"},{"id":14,"name":"Cheez-It Original","rarity":"common","filename":"snack-014.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-014.png"},{"id":15,"name":"Goldfish Cheddar","rarity":"common","filename":"snack-015.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-015.png"},{"id":16,"name":"Ritz Crackers","rarity":"common","filename":"snack-016.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-016.png"},{"id":17,"name":"Wheat Thins Original","rarity":"common","filename":"snack-017.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-017.png"},{"id":18,"name":"Triscuit Original","rarity":"common","filename":"snack-018.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-018.png"},{"id":19,"name":"Snyder's Mini Pretzels","rarity":"common","filename":"snack-019.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-019.png"},{"id":20,"name":"SkinnyPop Original Popcorn","rarity":"common","filename":"snack-020.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-020.png"},{"id":21,"name":"Smartfood White Cheddar Popcorn","rarity":"common","filename":"snack-021.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-021.png"},{"id":22,"name":"Pop Secret Movie Theater Butter","rarity":"common","filename":"snack-022.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-022.png"},{"id":23,"name":"Orville Redenbacher's Butter Popcorn","rarity":"common","filename":"snack-023.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-023.png"},{"id":24,"name":"Rice Krispies Treats Original","rarity":"common","filename":"snack-024.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-024.png"},{"id":25,"name":"Nature Valley Oats 'n Honey","rarity":"common","filename":"snack-025.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-025.png"},{"id":26,"name":"Oreo Original","rarity":"common","filename":"snack-026.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-026.png"},{"id":27,"name":"Chips Ahoy! Original","rarity":"common","filename":"snack-027.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-027.png"},{"id":28,"name":"Nutter Butter Cookies","rarity":"common","filename":"snack-028.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-028.png"},{"id":29,"name":"Nilla Wafers","rarity":"common","filename":"snack-029.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-029.png"},{"id":30,"name":"Teddy Grahams Honey","rarity":"common","filename":"snack-030.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-030.png"},{"id":31,"name":"Takis Fuego","rarity":"uncommon","filename":"snack-031.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-031.png"},{"id":32,"name":"Takis Blue Heat","rarity":"uncommon","filename":"snack-032.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-032.png"},{"id":33,"name":"Flamin' Hot Cheetos","rarity":"uncommon","filename":"snack-033.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-033.png"},{"id":34,"name":"Flamin' Hot Funyuns","rarity":"uncommon","filename":"snack-034.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-034.png"},{"id":35,"name":"Doritos Spicy Sweet Chili","rarity":"uncommon","filename":"snack-035.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-035.png"},{"id":36,"name":"Doritos Flamin' Hot Nacho","rarity":"uncommon","filename":"snack-036.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-036.png"},{"id":37,"name":"Pringles BBQ","rarity":"uncommon","filename":"snack-037.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-037.png"},{"id":38,"name":"Pringles Pizza","rarity":"uncommon","filename":"snack-038.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-038.png"},{"id":39,"name":"Cheez-It Extra Toasty","rarity":"uncommon","filename":"snack-039.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-039.png"},{"id":40,"name":"Cheez-It White Cheddar","rarity":"uncommon","filename":"snack-040.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-040.png"},{"id":41,"name":"Bugles Original","rarity":"uncommon","filename":"snack-041.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-041.png"},{"id":42,"name":"Gardetto's Original Recipe","rarity":"uncommon","filename":"snack-042.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-042.png"},{"id":43,"name":"Chex Mix Traditional","rarity":"uncommon","filename":"snack-043.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-043.png"},{"id":44,"name":"Combos Cheddar Cheese Pretzel","rarity":"uncommon","filename":"snack-044.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-044.png"},{"id":45,"name":"Andy Capp's Hot Fries","rarity":"uncommon","filename":"snack-045.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-045.png"},{"id":46,"name":"M&M's Milk Chocolate","rarity":"uncommon","filename":"snack-046.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-046.png"},{"id":47,"name":"M&M's Peanut","rarity":"uncommon","filename":"snack-047.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-047.png"},{"id":48,"name":"Skittles Original","rarity":"uncommon","filename":"snack-048.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-048.png"},{"id":49,"name":"Starburst Original","rarity":"uncommon","filename":"snack-049.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-049.png"},{"id":50,"name":"Sour Patch Kids Original","rarity":"uncommon","filename":"snack-050.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-050.png"},{"id":51,"name":"Sour Patch Kids Watermelon","rarity":"rare","filename":"snack-051.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-051.png"},{"id":52,"name":"Swedish Fish Original","rarity":"rare","filename":"snack-052.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-052.png"},{"id":53,"name":"Trolli Sour Brite Crawlers","rarity":"rare","filename":"snack-053.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-053.png"},{"id":54,"name":"Haribo Goldbears","rarity":"rare","filename":"snack-054.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-054.png"},{"id":55,"name":"Haribo Twin Snakes","rarity":"rare","filename":"snack-055.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-055.png"},{"id":56,"name":"Nerds Gummy Clusters","rarity":"rare","filename":"snack-056.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-056.png"},{"id":57,"name":"Nerds Rope Rainbow","rarity":"rare","filename":"snack-057.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-057.png"},{"id":58,"name":"Airheads Xtremes Rainbow Berry","rarity":"rare","filename":"snack-058.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-058.png"},{"id":59,"name":"Airheads Cherry","rarity":"rare","filename":"snack-059.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-059.png"},{"id":60,"name":"Jolly Rancher Hard Candy","rarity":"rare","filename":"snack-060.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-060.png"},{"id":61,"name":"Life Savers Gummies","rarity":"rare","filename":"snack-061.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-061.png"},{"id":62,"name":"Twizzlers Strawberry","rarity":"rare","filename":"snack-062.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-062.png"},{"id":63,"name":"Red Vines Original Red","rarity":"rare","filename":"snack-063.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-063.png"},{"id":64,"name":"Mike and Ike Original Fruits","rarity":"rare","filename":"snack-064.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-064.png"},{"id":65,"name":"Hot Tamales Cinnamon Candy","rarity":"rare","filename":"snack-065.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-065.png"},{"id":66,"name":"Reese's Peanut Butter Cups","rarity":"rare","filename":"snack-066.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-066.png"},{"id":67,"name":"Reese's Pieces","rarity":"rare","filename":"snack-067.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-067.png"},{"id":68,"name":"Hershey's Milk Chocolate Bar","rarity":"rare","filename":"snack-068.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-068.png"},{"id":69,"name":"Hershey's Cookies 'n' Creme","rarity":"rare","filename":"snack-069.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-069.png"},{"id":70,"name":"Kit Kat Original","rarity":"rare","filename":"snack-070.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-070.png"},{"id":71,"name":"Snickers Original","rarity":"epic","filename":"snack-071.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-071.png"},{"id":72,"name":"Twix Original","rarity":"epic","filename":"snack-072.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-072.png"},{"id":73,"name":"Milky Way Original","rarity":"epic","filename":"snack-073.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-073.png"},{"id":74,"name":"3 Musketeers Original","rarity":"epic","filename":"snack-074.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-074.png"},{"id":75,"name":"Butterfinger Original","rarity":"epic","filename":"snack-075.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-075.png"},{"id":76,"name":"Baby Ruth Original","rarity":"epic","filename":"snack-076.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-076.png"},{"id":77,"name":"100 Grand Bar","rarity":"epic","filename":"snack-077.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-077.png"},{"id":78,"name":"Crunch Chocolate Bar","rarity":"epic","filename":"snack-078.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-078.png"},{"id":79,"name":"Almond Joy","rarity":"epic","filename":"snack-079.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-079.png"},{"id":80,"name":"Mounds","rarity":"epic","filename":"snack-080.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-080.png"},{"id":81,"name":"Rolo Milk Chocolate Caramels","rarity":"epic","filename":"snack-081.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-081.png"},{"id":82,"name":"York Peppermint Pattie","rarity":"epic","filename":"snack-082.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-082.png"},{"id":83,"name":"Dove Milk Chocolate Promises","rarity":"epic","filename":"snack-083.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-083.png"},{"id":84,"name":"Lindt Lindor Milk Chocolate Truffles","rarity":"epic","filename":"snack-084.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-084.png"},{"id":85,"name":"Ghirardelli Milk Chocolate Caramel Squares","rarity":"epic","filename":"snack-085.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-085.png"},{"id":86,"name":"Kinder Bueno","rarity":"epic","filename":"snack-086.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-086.png"},{"id":87,"name":"Kinder Joy","rarity":"epic","filename":"snack-087.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-087.png"},{"id":88,"name":"Ferrero Rocher","rarity":"epic","filename":"snack-088.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-088.png"},{"id":89,"name":"Toblerone Milk Chocolate","rarity":"epic","filename":"snack-089.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-089.png"},{"id":90,"name":"Pocky Chocolate","rarity":"epic","filename":"snack-090.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-090.png"},{"id":91,"name":"Oreo Double Stuf","rarity":"legendary","filename":"snack-091.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-091.png"},{"id":92,"name":"Oreo Golden","rarity":"legendary","filename":"snack-092.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-092.png"},{"id":93,"name":"Reese's Take 5","rarity":"legendary","filename":"snack-093.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-093.png"},{"id":94,"name":"Reese's Fast Break","rarity":"legendary","filename":"snack-094.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-094.png"},{"id":95,"name":"Reese's NutRageous","rarity":"legendary","filename":"snack-095.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-095.png"},{"id":96,"name":"Kit Kat Duos Mint + Dark Chocolate","rarity":"legendary","filename":"snack-096.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-096.png"},{"id":97,"name":"M&M's Pretzel","rarity":"legendary","filename":"snack-097.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-097.png"},{"id":98,"name":"M&M's Peanut Butter","rarity":"legendary","filename":"snack-098.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-098.png"},{"id":99,"name":"Pop-Tarts Frosted Brown Sugar Cinnamon","rarity":"mythic","filename":"snack-099.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-099.png"},{"id":100,"name":"Little Debbie Cosmic Brownies","rarity":"mythic","filename":"snack-100.png","image_url":"https://inftkwxwqkyhzrqxmiey.supabase.co/storage/v1/object/public/snack-images/snack-100.png"}];
const catalogKey = name => String(name || '').trim().toLocaleLowerCase('en-US');
function isOwnerVault() { return creator && String(creator.slug || '').toLowerCase() === 'underscorepower'; }
function refreshOwnerCatalog() {
  const panel = $('ownerCatalog');
  if (!panel) return;
  panel.classList.toggle('hidden', !isOwnerVault());
  if (!isOwnerVault()) return;
  const inDb = new Set(snacks.filter(s => !s.archived).map(s => catalogKey(s.name)));
  const count = OWNER_SNACK_CATALOG.filter(s => inDb.has(catalogKey(s.name))).length;
  $('ocTotal').textContent = OWNER_SNACK_CATALOG.length;
  $('ocAdded').textContent = count;
  $('ocMissing').textContent = OWNER_SNACK_CATALOG.length - count;
  const q = $('ocSearch').value.trim().toLocaleLowerCase('en-US');
  const rarity = $('ocRarity').value;
  const list = OWNER_SNACK_CATALOG.filter(s => (rarity === 'all' || s.rarity === rarity) && catalogKey(s.name).includes(q));
  $('ocGrid').innerHTML = list.map(s => `<article class="oc-item"><div class="oc-photo"><img src="${esc(s.image_url)}" alt="${esc(s.name)}" loading="lazy" onerror="this.style.display='none'"></div><div class="oc-info"><div class="oc-name">${esc(s.name)}</div><div class="oc-meta"><span>${esc(s.rarity)}</span><span class="${inDb.has(catalogKey(s.name)) ? 'oc-in-db' : 'oc-missing'}">${inDb.has(catalogKey(s.name)) ? 'IN VAULT' : 'NOT IMPORTED'}</span></div></div></article>`).join('') || '<p>No matching snacks.</p>';
}
$('ocSearch').addEventListener('input', refreshOwnerCatalog);
$('ocRarity').addEventListener('change', refreshOwnerCatalog);
$('ocImport').addEventListener('click', async () => {
  if (!isOwnerVault()) return;
  const existing = new Set(snacks.map(s => catalogKey(s.name)));
  const missing = OWNER_SNACK_CATALOG.filter(s => !existing.has(catalogKey(s.name)));
  if (!missing.length) { $('ocStatus').textContent = 'All 100 snacks are already in the database.'; return; }
  if (!confirm(`Import ${missing.length} missing snacks into your Vault? They will start DISABLED so they cannot unexpectedly change live pull odds. You can enable them in the Snacks table.`)) return;
  const button = $('ocImport');
  button.disabled = true;
  $('ocStatus').textContent = 'Importing...';
  try {
    // Uses the authenticated creator and existing owner-write RLS policy.
    const weights = {common:100, uncommon:80, rare:55, epic:35, legendary:20, mythic:10};
    let done = 0;
    for (let i = 0; i < missing.length; i += 20) {
      const rows = missing.slice(i,i+20).map(s => ({creator_id:creator.id, name:s.name, rarity:s.rarity[0].toUpperCase()+s.rarity.slice(1), category:'Snack', description:'', image_url:s.image_url, weight:weights[s.rarity] ?? 50, enabled:false, archived:false}));
      const {error} = await supabase.from('snacks').insert(rows);
      if (error) throw error;
      done += rows.length;
      $('ocStatus').textContent = `Imported ${done} of ${missing.length}...`;
    }
    await refreshDashboard();
    $('ocStatus').textContent = `Imported ${done} snacks. They are disabled until you enable them.`;
  } catch (error) {
    $('ocStatus').textContent = `Import stopped: ${error.message}. Refresh to check which snacks were saved.`;
    try { await loadSnacks(); } catch (_) {}
  } finally { button.disabled = false; }
});

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
  refreshOwnerCatalog();
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
