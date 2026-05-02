-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5.8 — Enhanced welcome message
-- ════════════════════════════════════════════════════════════════════════════
-- Run AFTER v7.6.5.5. Idempotent — safe to run multiple times.
-- Replaces profiles_send_welcome() with an updated message that points new
-- users at the Manual, Code of Conduct, Discord (matchmaking + voice +
-- community), and the in-app lobby chat.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.profiles_send_welcome() returns trigger as $$
begin
  insert into public.inbox_messages(user_id, kind, title, body, sender_alias)
  values (
    NEW.user_id, 'welcome', 'Welcome to TCG Playsim ⚔',
    'Welcome ' || NEW.alias || E' to TCG Playsim! \U0001F389\n\n' ||
    E'This is a free browser-based playtester for Magic: The Gathering. ' ||
    E'Build decks with Scryfall search, customise sleeves and playmats, and ' ||
    E'play with up to four players online — no download required.\n\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' ||
    E'GETTING STARTED\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' ||
    E'📖 Read the Manual — top-right Help menu has the full guide. ' ||
    E'Press ? or / at any time during a game to see every hotkey.\n\n' ||
    E'📜 Read the Code of Conduct — also in the Help menu. We expect ' ||
    E'civility, fair play, and respect for every player. The automod, ' ||
    E'moderators, and community help keep things friendly.\n\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' ||
    E'COMMUNITY\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' ||
    E'🎮 Join our Discord: https://discord.gg/2AQWbPNEk\n\n' ||
    E'On Discord you can:\n' ||
    E'• Find matchmaking partners for any format\n' ||
    E'• Join voice channels alongside game rooms\n' ||
    E'• Suggest features, report bugs, share decks\n' ||
    E'• Hang out with other planeswalkers\n\n' ||
    E'💬 The in-app Lobby Chat (left side of the main menu) is also great ' ||
    E'for finding pickup games and chatting between matches.\n\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' ||
    E'FORMATS SUPPORTED\n' ||
    E'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' ||
    E'Standard · Commander (EDH) · Oathbreaker · Modern · Pioneer · Pauper ' ||
    E'· Legacy · Dandân (shared deck format)\n\n' ||
    E'Have fun. Be excellent to each other. ✦',
    'TCG Playsim'
  );
  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger is unchanged from v7.6.5.3 — re-create idempotently to be safe.
drop trigger if exists profiles_welcome_trg on public.profiles;
create trigger profiles_welcome_trg
  after insert on public.profiles
  for each row execute function public.profiles_send_welcome();

notify pgrst, 'reload schema';
