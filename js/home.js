import { supabase } from './api.js';

const grid = document.getElementById('communityGrid');

function creatorCard(creator) {
  const card = document.createElement('a');
  card.className = 'community';
  card.href = `/${encodeURIComponent(creator.slug)}`;
  const icon = document.createElement('div');
  icon.className = 'community-icon';
  icon.textContent = String(creator.name || creator.slug).slice(0, 2).toUpperCase();
  const heading = document.createElement('h3');
  heading.textContent = creator.name || creator.slug;
  const description = document.createElement('p');
  description.textContent = `Explore ${creator.name || creator.slug}'s Snack Vault, collect snacks from stream pulls and climb the leaderboard.`;
  const tag = document.createElement('span');
  tag.className = 'tag'; tag.textContent = 'SNACK VAULT';
  const enter = document.createElement('div');
  enter.className = 'enter';
  const label = document.createElement('span'); label.textContent = 'Enter Community';
  const arrow = document.createElement('span'); arrow.textContent = '→';
  enter.append(label, arrow);
  card.append(icon, heading, description, tag, enter);
  return card;
}

async function loadCommunities() {
  try {
    const { data, error } = await supabase.from('creators').select('slug,name').order('name');
    if (error) throw error;
    const cards = (data || []).filter(creator => creator.slug).map(creatorCard);
    grid.replaceChildren(...cards);
    if (!cards.length) {
      const text = document.createElement('p');
      text.textContent = 'Create a Snack Vault to start your community collection.';
      grid.append(text);
    }
    const join = document.createElement('a');
    join.className = 'community'; join.href = '/admin';
    const title = document.createElement('h3'); title.textContent = 'Start your Snack Vault';
    const description = document.createElement('p');
    description.textContent = 'Create your own collection, connect Twitch, and invite your community.';
    join.append(title, description); grid.append(join);
  } catch {
    const text = document.createElement('p');
    text.textContent = 'Could not load communities. Refresh to try again.';
    grid.replaceChildren(text);
  }
}

loadCommunities();
