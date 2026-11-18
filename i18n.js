// Langue de l'interface : le code et le HTML sont écrits en français, cette couche traduit en anglais à l'affichage.
// Textes exacts (D), modèles avec trous {} (P), préfixes du type « Erreur : … » ; tout ce qui porte translate="no" est ignoré
// (titres de jeux, pseudos, résumés Wikipédia…). Changer de langue recharge la fenêtre.
(function () {
  let lang = '';
  try { lang = localStorage.getItem('emuglob-lang') || ''; } catch { /* stockage indisponible */ }
  if (lang !== 'fr' && lang !== 'en') lang = /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
  window.LANG = lang;
  window.LOC = lang === 'en' ? 'en-US' : 'fr-FR';
  window.sysLang = () => (/^fr/i.test(navigator.language || '') ? 'fr' : 'en');
  if (lang !== 'en') { window.T = (s) => s; return; }
  document.documentElement.lang = 'en';

  const D = {
    // barre du haut, accueil
    'Jeux': 'Games', 'Amis': 'Friends', 'Paramètres': 'Settings', 'Succès': 'Achievements', 'Hors ligne': 'Offline', 'Jouer': 'Play', '▶ Jouer': '▶ Play',
    'Bibliothèque': 'Library', 'Tout réduire': 'Collapse all', 'Tout ouvrir': 'Expand all', 'Fermer': 'Close', 'Réglages': 'Settings', 'Plein écran': 'Full screen',
    'Fermer le jeu': 'Close game', 'Mon profil': 'My profile', 'Compte': 'Account', 'Amis RetroAchievements': 'RetroAchievements friends', 'Actualiser': 'Refresh',
    'Rechercher un jeu…': 'Search for a game…', 'Pas de connexion : Emuglob utilise les jaquettes et infos déjà enregistrées': 'No connection: Emuglob uses the covers and info already saved',
    'Fiche du jeu (touche I)': 'Game sheet (I key)', 'Jeu au hasard (touche R)': 'Random game (R key)', 'Options': 'Options', 'Trier / filtrer': 'Sort / filter',
    'Couper / remettre le son': 'Mute / unmute', "Volume de l'émulateur": 'Emulator volume', 'Manette': 'Controller', 'Favori': 'Favorite', 'Console': 'Console',
    'Gauche / Droite': 'Left / Right', 'Haut / Bas': 'Up / Down', 'Système ?': 'System?', "à l'instant": 'just now', 'moins d\'1 min': 'less than 1 min',
    'Temps de jeu': 'Play time', 'Dernier lancement': 'Last played', "Date d'ajout": 'Date added', '· jamais lancés seulement': '· never played only',
    'Trier par': 'Sort by', 'Filtre': 'Filter', 'Jamais lancés seulement': 'Never played only', 'Tous': 'All', 'Récents': 'Recent', 'Favoris': 'Favorites', 'Consoles': 'Consoles',
    'Succès : jeu non reconnu sur RetroAchievements': 'Achievements: game not recognized on RetroAchievements', 'Succès : chargement…': 'Achievements: loading…',
    'Aucun jeu dans cet onglet': 'No games in this tab', 'Bienvenue dans Emuglob': 'Welcome to Emuglob', "Ajoute tes jeux dans l'onglet Paramètres": 'Add your games in the Settings tab',
    'Jamais lancé': 'Never played', 'de jeu': 'played', 'Fichier introuvable': 'File not found', 'Trophées': 'Trophies', 'Lier RetroAchievements': 'Link RetroAchievements',
    'Aurore': 'Aurora', 'Néon': 'Neon', 'Phosphore': 'Phosphor', 'Clair': 'Light', 'Pastel': 'Pastel', 'Ce jeu': 'This game', 'Aucun jeu trouvé': 'No game found',
    'Retirer des favoris': 'Remove from favorites', 'Ajouter aux favoris': 'Add to favorites', 'Jeu retiré': 'Removed game', 'illisible': 'unreadable', 'Chargement…': 'Loading…',
    // modifier un jeu
    'Modifier le jeu': 'Edit game', 'Titre': 'Title', 'Émulateur': 'Emulator', 'Système': 'System', 'Core libretro': 'Libretro core',
    'RetroAchievements : ID, lien du jeu ou nom du jeu (vide = automatique)': 'RetroAchievements: ID, game link or game name (empty = automatic)',
    'Choisir une jaquette…': 'Choose a cover…', 'Retirer la jaquette': 'Remove cover', 'Supprimer': 'Delete', 'Annuler': 'Cancel', 'OK': 'OK',
    'ex : snes9x_libretro': 'e.g. snes9x_libretro', 'ex : 1446, lien retroachievements.org/game/1446, ou Super Mario World': 'e.g. 1446, link retroachievements.org/game/1446, or Super Mario World',
    'ex : C:\\Emus\\mGBA\\saves': 'e.g. C:\\Emus\\mGBA\\saves', '— choisir —': '— choose —', 'Jaquette définie.': 'Cover set.', 'Jaquette retirée.': 'Cover removed.',
    // émulateurs
    'Émulateurs': 'Emulators', 'Nom': 'Name', 'Exécutable': 'Executable', 'Parcourir…': 'Browse…', 'Arguments de lancement ({game} = chemin du jeu)': 'Launch arguments ({game} = game path)',
    'Partager ses sauvegardes de cartouche (même jeu sur RALibretro et cet émulateur)': 'Share its cartridge saves (same game on RALibretro and this emulator)',
    'Dossier de ses sauvegardes (vide = à côté du jeu)': 'Its save folder (empty = next to the game)',
    'Extension de ses sauvegardes (.sav mGBA / melonDS / SameBoy, .srm Snes9x)': 'Its save extension (.sav mGBA / melonDS / SameBoy, .srm Snes9x)',
    '+ Nouvel émulateur': '+ New emulator', 'Nouvel émulateur': 'New emulator',
    // installation
    'Installer': 'Install', 'Installé': 'Installed', 'Dernière version': 'Latest version', 'Cores de base': 'Basic cores', 'Importer mon keys.txt': 'Import my keys.txt',
    'Une mise à jour garde tes réglages, cores et sauvegardes.': 'An update keeps your settings, cores and saves.',
    'RALibretro est un logiciel libre (GPL-3.0) de RetroAchievements, distinct d\'Emuglob.': 'RALibretro is free software (GPL-3.0) by RetroAchievements, separate from Emuglob.',
    'Tes réglages et tes jeux installés restent en place. Cemu a besoin des': 'Your settings and installed games stay in place. Cemu needs the',
    'clés tirées de ta propre console': 'keys dumped from your own console',
    '(keys.txt) pour les jeux chiffrés (.wud, .wux) : elles ne sont pas fournies. « Importer mon keys.txt » le copie au bon endroit pour Cemu. Les jeux extraits (.rpx) et .wua n\'en ont généralement pas besoin.':
      '(keys.txt) for encrypted games (.wud, .wux): they are not provided. "Import my keys.txt" copies it to the right place for Cemu. Extracted games (.rpx) and .wua usually don\'t need them.',
    'Cemu est un logiciel libre (MPL-2.0), distinct d\'Emuglob.': 'Cemu is free software (MPL-2.0), separate from Emuglob.',
    'Tes réglages et sauvegardes (Documents\\Dolphin Emulator) sont gardés. Wii et GameCube n\'ont pas besoin de BIOS.': 'Your settings and saves (Documents\\Dolphin Emulator) are kept. Wii and GameCube need no BIOS.',
    'Dolphin est un logiciel libre (GPL-2.0+), distinct d\'Emuglob.': 'Dolphin is free software (GPL-2.0+), separate from Emuglob.',
    'Tes réglages (Documents\\PCSX2) sont gardés.': 'Your settings (Documents\\PCSX2) are kept.', 'Aucun BIOS n\'est fourni': 'No BIOS is provided',
    ': PCSX2 a besoin du BIOS de ta propre console PS2 (à copier dans Documents\\PCSX2\\bios).': ': PCSX2 needs the BIOS from your own PS2 console (copy it to Documents\\PCSX2\\bios).',
    'PCSX2 est un logiciel libre (GPL-3.0), distinct d\'Emuglob.': 'PCSX2 is free software (GPL-3.0), separate from Emuglob.',
    'Téléchargé depuis la source officielle.': 'Downloaded from the official source.', 'Recherche de la dernière version…': 'Looking for the latest version…',
    'Dernière version introuvable.': 'Latest version not found.', 'Réinstaller': 'Reinstall', 'Non installé': 'Not installed', 'Fichier abîmé': 'Damaged file',
    'conseillé': 'recommended', 'utilisé par tes jeux': 'used by your games', 'Pense au BIOS de ta PS2.': 'Remember your PS2 BIOS.',
    'Clique sur « Cores de base » pour avoir un core par console.': 'Click "Basic cores" to get one core per console.',
    'Core manquant': 'Missing core', 'Télécharger': 'Download', 'Cores RALibretro': 'RALibretro cores', 'Installer les cores de base': 'Install basic cores',
    'Les cores sont téléchargés depuis le site officiel de libretro (buildbot.libretro.com, Windows 64 bits) et placés dans le dossier Cores de RALibretro. Ce sont des logiciels libres, distincts d\'Emuglob.':
      'Cores are downloaded from the official libretro site (buildbot.libretro.com, Windows 64-bit) into RALibretro\'s Cores folder. They are free software, separate from Emuglob.',
    'Téléchargés depuis le site officiel de libretro (buildbot.libretro.com, Windows 64 bits) dans le dossier Cores de RALibretro. « Mettre à jour » reprend la dernière version. Logiciels libres, distincts d\'Emuglob.':
      'Downloaded from the official libretro site (buildbot.libretro.com, Windows 64-bit) into RALibretro\'s Cores folder. "Update" gets the latest version. Free software, separate from Emuglob.',
    'Emuglob peut télécharger': 'Emuglob can download', 'et lancer': 'and launch', 'ensuite.': 'afterwards.', 'Télécharger et jouer': 'Download and play',
    'RALibretro n\'est pas installé : installe-le d\'abord (Paramètres, Installation, RALibretro).': 'RALibretro is not installed: install it first (Settings, Installation, RALibretro).',
    'Cores de base installés': 'Basic cores installed', 'installé(s)': 'installed',
    'RALibretro n\'est pas installé : Paramètres, Installation, pour l\'installer en un clic.': 'RALibretro is not installed: Settings, Installation, to install it in one click.',
    // sauvegardes
    'Retrouver mes sauvegardes': 'Find my saves', 'Les fichiers trouvés sont': 'Files found are', 'copiés': 'copied',
    'dans les sauvegardes d\'Emuglob : l\'original n\'est ni déplacé ni modifié, et une sauvegarde déjà présente dans Emuglob part d\'abord dans l\'historique du jeu. Au prochain lancement, Emuglob la donne à l\'émulateur si elle est plus récente que la sienne.':
      'into Emuglob\'s saves: the original is neither moved nor changed, and a save already in Emuglob first goes to the game\'s history. On the next launch, Emuglob gives it to the emulator if it is newer than its own.',
    'Les cartes mémoire communes à tous les jeux (PCSX2, Dolphin) restent dans leur émulateur.': 'Memory cards shared by all games (PCSX2, Dolphin) stay in their emulator.',
    'Importer des fichiers…': 'Import files…', 'Chercher dans un autre dossier…': 'Search another folder…', 'Importer': 'Import',
    'Sauvegardes': 'Saves', 'Copies gardées par Emuglob (10 dernières)': 'Copies kept by Emuglob (last 10)', 'Ouvrir le dossier': 'Open folder', 'Copier maintenant': 'Copy now',
    'Aucune sauvegarde trouvée pour les jeux de ta bibliothèque.': 'No saves found for the games in your library.', 'déjà importée': 'already imported',
    'plus ancienne': 'older', 'nom proche': 'similar name', 'Ne rien importer': 'Import nothing', 'Fichiers à associer à un jeu': 'Files to match with a game',
    'Ne pas importer': "Don't import", 'Importer la sélection': 'Import selection', 'Recherche en cours…': 'Searching…', 'Rien de coché.': 'Nothing checked.',
    'Cemu (Wii U)': 'Cemu (Wii U)', 'Cemu n\'a pas encore de sauvegarde pour ce jeu (ou ne la trouve pas : lance le jeu une fois depuis Emuglob).': 'Cemu has no save for this game yet (or can\'t find it: launch the game once from Emuglob).',
    'Aucune copie pour l\'instant. Emuglob en fait une à la fin de chaque partie lancée depuis Emuglob.': 'No copies yet. Emuglob makes one at the end of each session started from Emuglob.',
    'Sauvegardes de': 'Saves of', 'Remettre cette sauvegarde dans Cemu ? La sauvegarde actuelle est gardée dans Emuglob avant.': 'Put this save back into Cemu? The current save is kept in Emuglob first.',
    'Sauvegarde restaurée dans Cemu.': 'Save restored to Cemu.', 'Déjà à jour : rien de nouveau.': 'Already up to date: nothing new.', 'Copie faite.': 'Copy made.',
    'avant une restauration': 'before a restore', 'Déjà dans Emuglob : sauvegarde du': 'Already in Emuglob: save from', 'Restaurer': 'Restore',
    // tuto
    'Passer le tuto': 'Skip tutorial', 'Y aller': 'Go there', 'Précédent': 'Previous', 'Suivant': 'Next', 'Terminer': 'Finish',
    // contrôles
    'Contrôles': 'Controls', 'Zone morte': 'Dead zone', 'Branche une manette et appuie sur ses boutons : la manette s\'allume et l\'action réglée s\'affiche ici.': 'Plug in a controller and press its buttons: the controller lights up and the assigned action shows here.',
    'Enregistrer': 'Save', 'Changer d\'émulateur sans enregistrer les modifications ?': 'Switch emulator without saving changes?', 'Appuie sur une touche…': 'Press a key…',
    'Croix ↑': 'D-pad ↑', 'Croix ↓': 'D-pad ↓', 'Croix ←': 'D-pad ←', 'Croix →': 'D-pad →', 'rien de réglé dans cet onglet': 'nothing set in this tab',
    'Branche une manette pour voir le stick.': 'Plug in a controller to see the stick.', 'Pointillés : 12,5 % minimum imposés par RALibretro.': 'Dotted line: 12.5% minimum enforced by RALibretro.',
    'ignoré': 'ignored', 'Aucun émulateur compatible configuré (RALibretro, PCSX2, Dolphin ou Azahar). Renseigne son chemin dans Paramètres, Émulateurs.': 'No compatible emulator configured (RALibretro, PCSX2, Dolphin or Azahar). Set its path in Settings, Emulators.',
    'Boutons': 'Buttons', 'Raccourcis': 'Shortcuts', 'Raccourcis (clavier)': 'Shortcuts (keyboard)', 'Manette 1': 'Controller 1', 'Manette 2': 'Controller 2',
    'Afficher les FPS': 'Show FPS', 'Résolution interne': 'Internal resolution', 'Synchro verticale (VSync)': 'Vertical sync (VSync)', 'Vitesse du jeu': 'Game speed',
    'Accélérer': 'Speed up', 'Arrêter le jeu': 'Stop game', 'Arrêter': 'Stop', 'Avance rapide (activer/couper)': 'Fast forward (toggle)', 'Avance rapide (maintenir)': 'Fast forward (hold)',
    'Barre de filtre': 'Filter bar', 'Bouton Analog': 'Analog button', 'Carré □': 'Square □', 'Rond ○': 'Circle ○', 'Triangle △': 'Triangle △', 'Croix ✕': 'Cross ✕',
    'Chargement rapide (emplacement actif)': 'Quick load (active slot)', 'Chargement rapide': 'Quick load', 'Charger un Amiibo': 'Load an Amiibo', 'Connecter la Wiimote 1': 'Connect Wiimote 1',
    'Croix bas': 'D-pad down', 'Croix droite': 'D-pad right', 'Croix gauche': 'D-pad left', 'Croix haut': 'D-pad up', 'Disque suivant': 'Next disc', 'Début': 'Home',
    'Emplacement précédent': 'Previous slot', 'Emplacement suivant': 'Next slot', 'Entrée': 'Enter', 'Export des textures': 'Texture dump', 'Illimitée': 'Unlimited',
    'Image par image': 'Frame advance', 'Impr. écran': 'Print Screen', 'Inverser les écrans': 'Swap screens', 'L (analogique)': 'L (analog)', 'R (analogique)': 'R (analog)',
    'Limite de vitesse': 'Speed limit', 'Menu RetroAchievements': 'RetroAchievements menu', 'Menu pause': 'Pause menu', 'Mode focus jeu': 'Game focus mode',
    'Mode image par image': 'Frame advance mode', 'Normale (100 %)': 'Normal (100%)', 'Nunchuk stick bas': 'Nunchuk stick down', 'Nunchuk stick droite': 'Nunchuk stick right',
    'Nunchuk stick gauche': 'Nunchuk stick left', 'Nunchuk stick haut': 'Nunchuk stick up', 'Ouvrir le plateau du disque': 'Open disc tray', 'Ouvrir un fichier': 'Open a file',
    'Pause / reprendre': 'Pause / resume', 'Quitter Azahar': 'Quit Azahar', 'Quitter le plein écran': 'Exit full screen', 'Redémarrer': 'Restart', 'Rendu logiciel': 'Software rendering',
    'Retirer l’Amiibo': 'Remove Amiibo', 'Retour arr.': 'Backspace', 'Rotation des écrans': 'Rotate screens', 'Réinitialiser le jeu': 'Reset game', 'Réinitialiser': 'Reset',
    'Sauvegarde rapide (emplacement actif)': 'Quick save (active slot)', 'Sauvegarde rapide': 'Quick save', 'Stick C bas': 'C-stick down', 'Stick C droite': 'C-stick right',
    'Stick C gauche': 'C-stick left', 'Stick C haut': 'C-stick up', 'Stick D': 'R stick', 'Stick G': 'L stick', 'Stick bas': 'Stick down', 'Stick droit bas': 'Right stick down',
    'Stick droit droite': 'Right stick right', 'Stick droit gauche': 'Right stick left', 'Stick droit haut': 'Right stick up', 'Stick droite': 'Stick right',
    'Stick gauche bas': 'Left stick down', 'Stick gauche droite': 'Left stick right', 'Stick gauche gauche': 'Left stick left', 'Stick gauche haut': 'Left stick up',
    'Stick gauche': 'Stick left', 'Stick haut': 'Stick up', 'Succès RetroAchievements': 'RetroAchievements achievements', 'Textures perso': 'Custom textures',
    'Turbo (activer/couper)': 'Turbo (toggle)', 'Turbo (maintenir)': 'Turbo (hold)', 'Verr. maj': 'Caps Lock', 'Vitesse illimitée': 'Unlimited speed', 'Vitesse par jeu': 'Per-game speed',
    'Zone morte des sticks': 'Stick dead zone', 'Zone morte du stick C': 'C-stick dead zone', 'Zone morte du stick Nunchuk': 'Nunchuk stick dead zone', 'Zone morte du stick': 'Stick dead zone',
    'Arrêt défil': 'Scroll Lock', 'Échap': 'Esc', 'Maj': 'Shift', 'Maj D': 'R Shift', 'Ctrl D': 'R Ctrl', 'Page ↑': 'Page Up', 'Page ↓': 'Page Down', 'Inser': 'Ins',
    'DS : curseur du stylet au stick (DeSmuME)': 'DS: stylus cursor on stick (DeSmuME)', 'DS : curseur du stylet au stick (melonDS DS)': 'DS: stylus cursor on stick (melonDS DS)',
    'N64 : stick (Mupen64Plus-Next)': 'N64: stick (Mupen64Plus-Next)', 'N64 : stick (ParaLLEl N64)': 'N64: stick (ParaLLEl N64)',
    'pas de réglages rapides pour cet émulateur': 'no quick settings for this emulator', 'touche non reconnue': 'key not recognized', 'émulateur non pris en charge': 'emulator not supported',
    'combinaison de touches possible seulement si ce groupe utilise le clavier': 'key combinations only work if this group uses the keyboard', 'raccourcis Azahar : clavier uniquement': 'Azahar shortcuts: keyboard only',
    // paramètres : comptes, jeux
    'Pseudo RetroAchievements': 'RetroAchievements username', 'Clé API Web (retroachievements.org, Paramètres, Clés)': 'Web API key (retroachievements.org, Settings, Keys)',
    'Tester la connexion': 'Test connection', 'Jaquettes (récupérées automatiquement d\'après le nom du fichier ROM)': 'Covers (fetched automatically from the ROM file name)',
    'Rechercher les jaquettes manquantes': 'Find missing covers', 'Succès RetroAchievements (identification par empreinte du fichier, puis par titre)': 'RetroAchievements (identified by file hash, then by title)',
    'Relancer la détection des jeux': 'Run game detection again', 'Intégrer l\'émulateur dans la fenêtre Emuglob (expérimental, Windows)': 'Embed the emulator in the Emuglob window (experimental, Windows)',
    'Mode d\'intégration': 'Embedding mode', 'Superposé : fenêtre sans bordure collée sur Emuglob (recommandé, garde le menu de l\'émulateur)': 'Overlay: borderless window stuck on Emuglob (recommended, keeps the emulator menu)',
    'Enfant : vraie fenêtre dans Emuglob (l\'image peut rester noire)': 'Child: real window inside Emuglob (the picture may stay black)',
    'Mode stream : recopier l\'image du jeu dans Emuglob, pour la voir en partageant la fenêtre Emuglob sur Discord (mode Superposé)': 'Stream mode: mirror the game picture inside Emuglob so it shows when sharing the Emuglob window on Discord (Overlay mode)',
    'Ouvrir le journal d\'intégration': 'Open embedding log', 'Sinon, masquer Emuglob pendant le jeu (Ctrl+Maj+E pour le rouvrir)': 'Otherwise, hide Emuglob while playing (Ctrl+Shift+E to bring it back)',
    'Partager les sauvegardes entre émulateurs (+ copie de secours dans Emuglob)': 'Share saves between emulators (+ backup copy in Emuglob)',
    'Manette : A jouer · X options · Y favori · B retour · Start plein écran · LB/RB rien': 'Controller: A play · X options · Y favorite · B back · Start full screen · LB/RB nothing',
    'Fond d\'écran': 'Wallpaper', 'Choisir une image…': 'Choose an image…', 'Par défaut': 'Default', 'Démarrer Emuglob en plein écran': 'Start Emuglob in full screen',
    'Lancer Emuglob au démarrage de Windows': 'Launch Emuglob when Windows starts', 'Mode portable': 'Portable mode', 'Rendre portable': 'Make portable',
    'Langue': 'Language', '✓ Utilisée': '✓ In use', 'Utilisée': 'In use', 'Langue de Windows': 'Windows language', 'Interface en français': 'French interface', 'Interface en anglais': 'English interface', 'Fond d\'écran, plein écran, Windows': 'Wallpaper, full screen, Windows',
    'Afficher le jeu en cours sur mon profil Discord': 'Show the current game on my Discord profile', 'Automatique : il suffit que Discord soit ouvert sur ce PC.': 'Automatic: Discord just needs to be open on this PC.',
    'Connecté à Discord.': 'Connected to Discord.', 'connecté': 'connected',
    'Entretien de la bibliothèque': 'Library maintenance', 'Dossiers surveillés (Emuglob y cherche de nouveaux jeux à chaque démarrage)': 'Watched folders (Emuglob looks for new games there at each startup)',
    'Chercher de nouveaux jeux maintenant': 'Look for new games now', 'Fichiers': 'Files', 'Vérifier les fichiers': 'Check files', 'Retirer les jeux introuvables': 'Remove missing games',
    'Doublons': 'Duplicates', 'Retirer les doublons': 'Remove duplicates', 'Barre des consoles': 'Console bar', 'Affichage': 'Display',
    'En mode « Icônes seules », afficher les noms au survol': 'In "Icons only" mode, show names on hover',
    'Consoles (glisser ou ↑ ↓ pour l\'ordre · « Icône » pour mettre ton propre logo)': 'Consoles (drag or ↑ ↓ to reorder · "Icon" to use your own logo)',
    'Ordre alphabétique, tout afficher': 'Alphabetical order, show all', 'Thèmes et sons': 'Themes and sounds', 'Thème': 'Theme',
    'Couleur du fond selon la console sélectionnée': 'Background color based on the selected console',
    'Couleur personnalisée par console : Paramètres › Barre des consoles. Masqué si un fond d\'écran est choisi.': 'Custom color per console: Settings › Console bar. Hidden when a wallpaper is set.',
    'Sons de navigation (survol et sélection des jeux)': 'Navigation sounds (hovering and selecting games)', 'Volume des sons': 'Sound volume', 'Tester le son': 'Test sound',
    'Emuglob sauvegarde ta bibliothèque et tes réglages automatiquement (toutes les 6 heures au plus, 10 gardées).': 'Emuglob backs up your library and settings automatically (at most every 6 hours, 10 kept).',
    'Exporter…': 'Export…', 'Importer…': 'Import…', 'Glisser pour déplacer': 'Drag to move', 'Revenir à l\'icône par défaut': 'Back to the default icon',
    'Couleur du thème de cette console': 'Theme color for this console', 'Couleur par défaut': 'Default color', 'Icône': 'Icon', 'Aucune console pour l\'instant.': 'No consoles yet.',
    'Barre horizontale': 'Horizontal bar', 'Liste verticale': 'Vertical list', 'Icônes seules': 'Icons only', 'Automatique': 'Automatic', 'Une ligne en haut': 'One row at the top',
    'Liste à gauche avec icônes': 'List on the left with icons', 'Colonne d\'icônes à gauche': 'Icon column on the left', 'Horizontale, verticale au-delà de 10 consoles': 'Horizontal, vertical beyond 10 consoles',
    // mises à jour
    'Mettre à jour Emuglob': 'Update Emuglob', 'Recherche de mises à jour…': 'Checking for updates…', 'Installer la mise à jour': 'Install update', 'Voir sur GitHub': 'View on GitHub',
    'Rechercher à nouveau': 'Check again', 'Sinon, à la main : télécharge le nouveau fichier': 'Or by hand: download the new file',
    ', puis choisis-le ici : Emuglob se ferme, le remplace et se relance tout seul. L\'ancienne version est gardée pour pouvoir revenir en arrière.': ', then pick it here: Emuglob closes, replaces it and restarts by itself. The old version is kept so you can go back.',
    'Choisir un nouvel app.asar…': 'Choose a new app.asar…', 'Revenir à la version précédente': 'Go back to the previous version',
    'Elle doit être installée à la main (pas de app.asar attaché).': 'It must be installed by hand (no app.asar attached).',
    'Emuglob va télécharger la mise à jour, se fermer puis se relancer tout seul. L\'ancienne version est gardée. Continuer ?': 'Emuglob will download the update, close and restart by itself. The old version is kept. Continue?',
    'Téléchargement…': 'Downloading…', 'Installation en cours, Emuglob va redémarrer…': 'Installing, Emuglob will restart…',
    'Disponible seulement dans l\'application installée (pas en mode développement).': 'Only available in the installed app (not in development mode).',
    'Mise à jour en cours…': 'Updating…', 'Revenir à la version précédente ? Emuglob va se fermer puis se relancer.': 'Go back to the previous version? Emuglob will close and restart.',
    'Retour à la version précédente…': 'Going back to the previous version…',
    // fiche du jeu
    'Fiche du jeu': 'Game sheet', 'Voir la fiche du jeu': 'View game sheet', 'Recherche du résumé…': 'Looking for a summary…', 'Lire la suite': 'Read more',
    'Résumé indisponible hors ligne.': 'Summary unavailable offline.', 'Résumé indisponible pour le moment.': 'Summary unavailable right now.', 'Pas de résumé trouvé.': 'No summary found.',
    'Histoire principale': 'Main story', 'Tous les succès (softcore)': 'All achievements (softcore)', 'Maîtrise (hardcore)': 'Mastery (hardcore)',
    'Pas dans ta bibliothèque': 'Not in your library', 'Dans ta bibliothèque': 'In your library', 'Chargement du catalogue RetroAchievements…': 'Loading the RetroAchievements catalog…', 'Hash supportés': 'Supported hashes', 'Liste indisponible pour le moment.': 'List unavailable right now.', 'Aucun hash enregistré.': 'No hash registered.', 'Patch requis': 'Patch required', 'Seules ces versions débloquent les succès. Clic sur un MD5 pour le copier.': 'Only these versions unlock achievements. Click an MD5 to copy it.', 'MD5 copié.': 'MD5 copied.', 'Copier': 'Copy', 'Ma partie': 'My game', 'Parties': 'Sessions', 'Jamais': 'Never', 'Dernière fois': 'Last time', 'Ajouté le': 'Added on',
    'Durée de vie : temps médian des joueurs RetroAchievements': 'Length: median time of RetroAchievements players', 'Captures : RetroAchievements': 'Screenshots: RetroAchievements',
    'Lie ton compte RetroAchievements (Paramètres) pour voir les succès, la durée de vie et les infos du jeu.': 'Link your RetroAchievements account (Settings) to see achievements, game length and game info.',
    'Pas de succès RetroAchievements pour cette console.': 'No RetroAchievements for this console.',
    'Jeu non reconnu par RetroAchievements. Renseigne son ID dans Options, Modifier.': 'Game not recognized by RetroAchievements. Enter its ID in Options, Edit.',
    'Ta progression': 'Your progress', 'Prochains succès': 'Next achievements', 'Dernier succès': 'Latest achievement', 'Fichier': 'File', 'Reconnu par RetroAchievements ✓': 'Recognized by RetroAchievements ✓',
    '★ Favori': '★ Favorite', 'succès': 'achievements', 'Débloqué le': 'Unlocked on', 'Set secondaire RetroAchievements': 'RetroAchievements secondary set',
    // succès, profil
    'Renseigne ton pseudo et ta clé API RetroAchievements.': 'Enter your RetroAchievements username and API key.', 'Jeu sélectionné': 'Selected game', 'Débloqués (7 jours)': 'Unlocked (7 days)',
    'Sélectionne un jeu sur l\'accueil pour voir ses succès.': 'Select a game on the home screen to see its achievements.',
    'Ce jeu n\'a pas été reconnu. Renseigne son ID RetroAchievements dans Options, puis Modifier.': 'This game was not recognized. Enter its RetroAchievements ID in Options, then Edit.',
    'Aucun succès débloqué ces 7 derniers jours.': 'No achievements unlocked in the last 7 days.', 'Aucun jeu commencé sur RetroAchievements.': 'No game started on RetroAchievements.', 'Tous mes jeux': 'All my games', 'Lie ton compte RetroAchievements pour voir tes points et tes succès ici.': 'Link your RetroAchievements account to see your points and achievements here.',
    'Lier mon compte': 'Link my account', 'Chargement du profil…': 'Loading profile…', 'Réglages du compte': 'Account settings', 'Points (hardcore)': 'Points (hardcore)',
    'Points (softcore)': 'Points (softcore)', 'Jeux terminés': 'Games beaten', 'Jeux maîtrisés': 'Games mastered', 'Jeux joués': 'Games played', 'Succès débloqués': 'Achievements unlocked',
    'Récompenses': 'Awards', 'Succès (7 jours)': 'Achievements (7 days)', 'Terminé': 'Beaten', 'Maîtrisé': 'Mastered', 'Complété': 'Completed', 'Derniers jeux terminés': 'Latest games beaten',
    'Membre depuis le': 'Member since', 'Temps de jeu total': 'Total play time', 'Cette semaine': 'This week', 'Ce mois-ci': 'This month', 'Parties lancées': 'Sessions started',
    'Jeux lancés': 'Games started', 'Durée moyenne': 'Average length', 'Mon temps de jeu': 'My play time', 'Dernière partie': 'Last session', 'Jeux les plus joués': 'Most played games',
    'Organiser le profil': 'Arrange profile', 'Ordre des sections (↑ ↓ pour déplacer)': 'Section order (↑ ↓ to move)', 'Compte RetroAchievements': 'RetroAchievements account',
    'Ordre par défaut': 'Default order', 'Mes badges': 'My badges', 'Tous mes badges': 'All my badges', "Aucun badge pour l'instant.": 'No badges yet.', 'Masquer': 'Hide', 'Afficher': 'Show', 'Monter': 'Move up', 'Descendre': 'Move down',
    'Voir le profil': 'View profile', 'Retour': 'Back', '(succès débloqués)': '(achievements unlocked)',
    'Badges': 'Badges', 'Maîtrisés': 'Mastered', 'Complétés': 'Completed', 'Terminés': 'Beaten', 'Événements': 'Events', 'Site': 'Site', 'Événement': 'Event',
    'Terminé (softcore)': 'Beaten (softcore)', 'Afficher moins': 'Show less', 'Récompense': 'Award', 'Palier de succès': 'Achievement milestone', 'Palier de points': 'Points milestone',
    'Soutien Patreon': 'Patreon supporter', 'Légende certifiée': 'Certified legend', 'Développeur de succès': 'Achievement developer',
    'Temps par console': 'Time per console', 'Les stats « cette semaine » et « ce mois-ci » se remplissent à partir de ta prochaine partie.': '"This week" and "this month" stats fill in from your next session.',
    // amis
    'Chargement des amis…': 'Loading friends…', 'En jeu': 'In game', 'en jeu': 'in game', 'Jeu': 'Game', 'a débloqué': 'unlocked', 'Activité': 'Activity', 'Derniers succès': 'Latest achievements',
    '14 jours': '14 days', 'personne en jeu': 'nobody in game', 'dernier jeu': 'last game', 'nouveau jeu': 'new game', 'hors ligne, dernières infos connues': 'offline, last known info', '· dernier jeu': '· last game', '· hors ligne, dernières infos connues': '· offline, last known info',
    'Tu ne suis encore personne sur RetroAchievements. Suis des joueurs sur le site : leur activité apparaîtra ici.': "You don't follow anyone on RetroAchievements yet. Follow players on the site: their activity will show here.",
    'Aucun succès débloqué par toi ou tes amis ces 14 derniers jours.': 'No achievements unlocked by you or your friends in the last 14 days.',
    'Tu': 'You', 'as débloqué': 'unlocked',
    // bibliothèque, entretien
    'Aucun jeu.': 'No games.', 'hors ligne': 'offline', 'Aucun nouveau jeu.': 'No new games.', 'Aucun dossier surveillé : utilise « Scanner un dossier ».': 'No watched folder: use "Scan a folder".',
    'Retirer': 'Remove', 'Aucun dossier surveillé. « Scanner un dossier » en ajoute un.': 'No watched folders. "Scan a folder" adds one.', 'Tous les fichiers sont présents.': 'All files are present.',
    'Aucun doublon.': 'No duplicates.', 'Fichiers vérifiés.': 'Files checked.', 'Aucune sauvegarde pour l\'instant.': 'No backups yet.',
    'Restaurer cette sauvegarde ? La configuration actuelle est sauvegardée avant.': 'Restore this backup? The current configuration is backed up first.', 'Configuration exportée.': 'Configuration exported.',
    'Importer une configuration remplace la bibliothèque actuelle (une sauvegarde est faite avant). Continuer ?': 'Importing a configuration replaces the current library (a backup is made first). Continue?',
    // paramètres : sections
    'Jeux et émulateurs': 'Games and emulators', 'Installation': 'Installation', 'Apparence': 'Appearance', 'Comptes': 'Accounts', 'Bibliothèque en liste': 'Library as a list',
    'Tous les jeux par console': 'All games by console', 'Ajouter des jeux': 'Add games', 'Choisir des fichiers': 'Choose files', 'Scanner un dossier': 'Scan a folder',
    'Importer tes ROMs': 'Import your ROMs', 'Entretien': 'Maintenance', 'Dossiers surveillés, doublons': 'Watched folders, duplicates', 'Chemins et arguments': 'Paths and arguments',
    'Lancement des jeux': 'Launching games', 'Intégration, sauvegardes partagées': 'Embedding, shared saves', 'Installer ou mettre à jour': 'Install or update',
    'PlayStation 2 · installer ou mettre à jour': 'PlayStation 2 · install or update', 'Wii U · installer ou mettre à jour': 'Wii U · install or update',
    'Wii / GameCube · installer ou mettre à jour': 'Wii / GameCube · install or update', 'Un core par console · installer, mettre à jour': 'One core per console · install, update',
    'Touches et raccourcis par émulateur': 'Keys and shortcuts per emulator', 'Couleurs, sons de navigation': 'Colors, navigation sounds', ', ordre, icônes': ', order, icons',
    'Fond et démarrage': 'Wallpaper and startup', 'Fond d\'écran, langue, plein écran, Windows': 'Wallpaper, language, full screen, Windows', 'Compte, jaquettes, succès': 'Account, covers, achievements',
    'Discord': 'Discord', 'Statut de jeu activé': 'Game status on', 'Statut de jeu désactivé': 'Game status off', 'Rechercher des sauvegardes': 'Find saves',
    'Retrouver tes anciennes saves de jeux': 'Find your old game saves', 'Restaurer, exporter, importer': 'Restore, export, import', 'Aide et tuto': 'Help and tutorial',
    'Comment marche chaque fonction': 'How each feature works', 'Mettre à jour': 'Update', 'En ligne ou fichier app.asar': 'Online or app.asar file', 'Touche F11': 'F11 key',
    'Quitter': 'Quit', 'Fermer Emuglob': 'Close Emuglob', 'Relancer Emuglob': 'Restart Emuglob', 'Fermer puis rouvrir l\'application': 'Close and reopen the app',
    'Rendre Emuglob portable ?': 'Make Emuglob portable?', 'Tes données sont copiées dans le dossier data à côté d\'Emuglob.exe (celles de %APPDATA% restent intactes), puis Emuglob redémarre.':
      'Your data is copied to the data folder next to Emuglob.exe (the copy in %APPDATA% stays untouched), then Emuglob restarts.',
    'Mode portable activé : redémarrage…': 'Portable mode on: restarting…', 'réponse invalide': 'invalid response', 'Recherche des jaquettes…': 'Looking for covers…',
    'Détection des jeux en cours…': 'Detecting games…',
    // menu du jeu, lancement
    'Afficher le fichier': 'Show file', 'Lancer en fenêtre séparée': 'Launch in a separate window', 'Copies de sauvegarde': 'Save copies', 'Retirer de la bibliothèque': 'Remove from library',
    'Mode stream indisponible pour cet émulateur : l\'image du jeu ne sera pas visible dans le partage de la fenêtre.': 'Stream mode unavailable for this emulator: the game picture will not show when sharing the window.',
    'Mode stream : fenêtre de l\'émulateur introuvable pour la capture.': 'Stream mode: emulator window not found for capture.',
    'L\'émulateur n\'a pas encore joué de son : le réglage s\'appliquera dès qu\'il en jouera.': "The emulator hasn't played any sound yet: the setting applies as soon as it does.",
    'L\'émulateur s\'est fermé tout de suite. Vérifie son chemin et ses arguments (Paramètres, Émulateurs).': 'The emulator closed right away. Check its path and arguments (Settings, Emulators).',
    '· sauvegarde copiée dans Emuglob': '· save copied to Emuglob', 'Définis le système (Options, puis Modifier).': 'Set the system (Options, then Edit).',
    'Ce jeu Wii U (.wud/.wux) est chiffré : Cemu a besoin de ton keys.txt (clés tirées de ta propre console), introuvable pour l\'instant.': 'This Wii U game (.wud/.wux) is encrypted: Cemu needs your keys.txt (keys dumped from your own console), not found yet.',
    'Importer ton keys.txt maintenant ?': 'Import your keys.txt now?',
    'Jeu Wii U incomplet : ce .rpx est seul. Il faut le dossier complet du jeu (code, content et meta) et ajouter le .rpx qui est dans code. Un .wua, .wux ou .wud marche aussi.':
      'Incomplete Wii U game: this .rpx is on its own. You need the full game folder (code, content and meta) and add the .rpx inside code. A .wua, .wux or .wud works too.',
    'Voir sur RetroAchievements': 'View on RetroAchievements',
    // erreurs renvoyées par Emuglob
    'RetroAchievements non configuré': 'RetroAchievements not set up', 'Pseudo ou clé API refusés': 'Username or API key rejected', 'pas de réponse': 'no response',
    'aucune version précédente': 'no previous version', 'RALibretro introuvable': 'RALibretro not found', 'RALibretro est ouvert : ferme-le avant.': 'RALibretro is open: close it first.',
    'RALibretro est ouvert : ferme-le pour mettre à jour ce core.': 'RALibretro is open: close it to update this core.', 'Cemu est ouvert : ferme-le avant de restaurer.': 'Cemu is open: close it before restoring.',
    'Emuglob est déjà en mode portable.': 'Emuglob is already in portable mode.', 'téléchargement incomplet': 'incomplete download', 'fichier introuvable': 'file not found',
    'copie introuvable': 'copy not found', 'émulateur inconnu': 'unknown emulator', 'nom invalide': 'invalid name', 'Arguments invalides.': 'Invalid arguments.',
    'aucune sauvegarde de ce jeu dans Cemu': 'no save for this game in Cemu', 'dossier mlc01 de Cemu introuvable': "Cemu's mlc01 folder not found", 'lien de téléchargement manquant': 'download link missing',
    'GitHub limite les requêtes, réessaie plus tard': 'GitHub is rate limiting, try again later', 'fichier sans liste de jeux': 'file without a game list', 'sauvegarde sans liste de jeux': 'backup without a game list',
    'en-tête asar invalide': 'invalid asar header', 'fichier corrompu (empreinte SHA-256 différente)': 'corrupted file (different SHA-256 hash)',
    'fichier altéré (empreinte SHA-256 différente de celle de GitHub)': "tampered file (SHA-256 hash differs from GitHub's)", 'aucun jeu intégré': 'no embedded game',
    'ce fichier ne ressemble pas à un keys.txt (une clé de 32 caractères hexadécimaux par ligne)': "this file doesn't look like a keys.txt (one 32-character hex key per line)",
    'dossier de sauvegarde de Cemu inconnu pour ce jeu : lance-le une fois dans Cemu': "Cemu save folder unknown for this game: launch it once in Cemu",
    'Discord introuvable': 'Discord not found', 'déconnecté': 'disconnected',
  };

  // modèles : {} = trou, traduit à son tour ; {1} {2}… pour changer l'ordre en anglais
  const P = [
    ['il y a {} min', '{} min ago'], ['il y a {} h', '{} h ago'], ['il y a {} j', '{} d ago'], ['Vu {}', 'Seen {}'],
    ['{} h {} min', '{} h {} min'], ['{} {}/{} succès · {} pts', '{} {}/{} achievements · {} pts'], ['{}/{} succès', '{}/{} achievements'], ['{} succès', '{} achievements'],
    ['Dernière partie {}', 'Last session {}'], ['{} partie(s)', '{} session(s)'], ['Tout afficher ({})', 'Show all ({})'], ['Hash supportés ({})', 'Supported hashes ({})'], ['Profil de {}', "{}'s profile"], ['{} parties', '{} sessions'], ['{} partie', '{} session'],
    ['Fichier introuvable : {}. Disque débranché ?', 'File not found: {}. Drive unplugged?'], ['keys.txt importé ({} clés).', 'keys.txt imported ({} keys).'],
    ['keys.txt importé ({} clés) dans {}.', 'keys.txt imported ({} keys) to {}.'],
    ['Jeu Wii U incomplet : dossier {} absent à côté de code ({}). Recopie le jeu en entier.', 'Incomplete Wii U game: {} folder missing next to code ({}). Copy the whole game again.'],
    ['Sauvegarde reprise depuis {} (l\'ancienne est gardée en copie).', 'Save taken from {} (the old one is kept as a copy).'],
    ['{} jeu(x)', '{} game(s)'], ['{} % des joueurs', '{}% of players'], ['{} joueurs sur RetroAchievements', '{} players on RetroAchievements'], ['{} pts', '{} pts'],
    ['{}/{} · {} pts', '{}/{} · {} pts'], ['Impossible de charger le profil ({}). Vérifie ton pseudo et ta clé API.', "Couldn't load the profile ({}). Check your username and API key."],
    ['{} nouveau(x) jeu(x) trouvé(s) dans tes dossiers.', '{} new game(s) found in your folders.'],
    ['{} jeu(x) dont le fichier est introuvable (disque débranché ?).', '{} game(s) whose file is missing (drive unplugged?).'],
    ['{} jeu(x) en double (même titre, même console).', '{} duplicate game(s) (same title, same console).'],
    ['Retirer {} jeu(x) dont le fichier est introuvable de la bibliothèque ? (Les fichiers ne sont pas touchés.)', 'Remove {} game(s) with a missing file from the library? (Files are not touched.)'],
    ['Retirer {} doublon(s) de la bibliothèque ? Pour chaque jeu, la version la plus jouée est gardée. (Les fichiers ne sont pas touchés.)', 'Remove {} duplicate(s) from the library? For each game, the most played version is kept. (Files are not touched.)'],
    ['Emuglob est à jour (dernière version : {}).', 'Emuglob is up to date (latest version: {}).'], ['Nouvelle version disponible : {}', 'New version available: {}'],
    ['Installer ce fichier ({} Ko) ? Emuglob va se fermer puis se relancer tout seul. L\'ancienne version est gardée.', 'Install this file ({} KB)? Emuglob will close and restart by itself. The old version is kept.'],
    ['Subset · {}', 'Subset · {}'], ['{} · {} ami(s){}', '{} · {} friend(s){}'], ['{} jeu(x) ajouté(s).', '{} game(s) added.'],
    ['Gros fichiers ignorés (extension inconnue) : {}.', 'Large files skipped (unknown extension): {}.'],
    ['Actif : tes réglages, jaquettes et sauvegardes sont dans {}. Les chemins du même disque sont enregistrés en relatif (clé USB, changement de lettre). Supprime portable.txt à côté d\'Emuglob.exe pour revenir à l\'installation normale.',
      'On: your settings, covers and saves are in {}. Paths on the same drive are stored as relative (USB stick, drive letter change). Delete portable.txt next to Emuglob.exe to go back to the normal install.'],
    ['Range réglages, jaquettes et sauvegardes dans {}, à côté d\'Emuglob.exe, pour l\'emporter sur une clé USB ou un autre disque.', 'Stores settings, covers and saves in {}, next to Emuglob.exe, to carry it on a USB stick or another drive.'],
    ['{} jaquette(s) trouvée(s) sur {} jeu(x) testé(s).', '{} cover(s) found out of {} game(s) checked.'], ['{} jeu(x) reconnu(s) sur {}.', '{} game(s) recognized out of {}.'],
    ['Fichier(s) modifié(s) : {} (une copie .bak est gardée). Clique une case puis appuie sur une touche ou un bouton de manette.', 'File(s) changed: {} (a .bak copy is kept). Click a box then press a key or controller button.'],
    ['{} réglage(s) enregistré(s) dans {}.', '{} setting(s) saved to {}.'], ['Manette détectée : {}. Appuie sur un bouton.', 'Controller detected: {}. Press a button.'],
    ['Stick à {}', 'Stick at {}'], ['Lancement de {}…', 'Launching {}…'], ['Chargement de {}…', 'Loading {}…'],
    ['Intégration impossible : {}. L\'émulateur tourne dans sa propre fenêtre (journal : Paramètres).', "Embedding failed: {}. The emulator runs in its own window (log: Settings)."],
    ['S\'applique au prochain lancement : {} réécrit ses réglages en quittant, Emuglob les enregistre donc juste après la fermeture du jeu.', 'Applies on next launch: {} rewrites its settings when quitting, so Emuglob saves them right after the game closes.'],
    ['Réglages enregistrés ({}) : ils s\'appliquent au prochain lancement.', 'Settings saved ({}): they apply on next launch.'],
    ['Retour à Emuglob · {} de jeu{}', 'Back to Emuglob · {} played{}'], ['Détecté automatiquement : {}.', 'Detected automatically: {}.'],
    ['Téléchargement… {}', 'Downloading… {}'], ['Dernière version ({})', 'Latest version ({})'], ['Non installé (sera placé dans {})', 'Not installed (will go to {})'],
    ['Version {}', 'Version {}'], ['{} est à jour.', '{} is up to date.'], ['Installer {}', 'Install {}'], ['Mettre à jour vers {}', 'Update to {}'], ['Installé · {}', 'Installed · {}'],
    ['{} {} installé{}.{}', (g) => `${g[0]} ${g[1]} installed.${g[3]}`], ['Cores manquants ({})', 'Missing cores ({})'], ['Cores de base ({})', 'Basic cores ({})'],
    ['{} cores installés, {} en échec ({}).', '{} cores installed, {} failed ({}).'], ['{} cores installés.', '{} cores installed.'],
    ['{} sauvegarde{} trouvée{} pour {} jeu{}. Choisis celle à importer pour chaque jeu.', (g) => `${g[0]} save${g[1] ? 's' : ''} found for ${g[3]} game${g[4] ? 's' : ''}. Choose which one to import for each game.`],
    ['{} sauvegarde{} importée{}{}.', (g) => `${g[0]} save${g[1] ? 's' : ''} imported${g[3]}.`], ['Dans Cemu : {}', 'In Cemu: {}'], ['{} : nouveau chemin enregistré.', '{}: new path saved.'],
    ['Téléchargement de {} ({}/{})…', 'Downloading {} ({}/{})…'], ['Core {} manquant', 'Missing {} core'],
    ['RALibretro n\'a aucun core pour la {} : le jeu ne peut pas se lancer.', 'RALibretro has no core for the {}: the game cannot start.'], ['{} installé.', '{} installed.'],
    ['Installer les cores de base ({})', 'Install basic cores ({})'], ['{}/{} {}. Échec : {}', '{}/{} {}. Failed: {}'], ['{} supprimé.', '{} deleted.'],
    ['Emuglob {} est disponible (Paramètres › Mettre à jour Emuglob).', 'Emuglob {} is available (Settings › Update Emuglob).'],
    ['Résumé : Wikipédia{}, licence CC BY-SA', 'Summary: Wikipedia{}, CC BY-SA license'], [' (en français, pas de page en anglais)', ' (in French, no English page)'],
    ['Format {}', 'Format {}'], ['fichier introuvable : {}. Lance {} une fois pour le créer.', 'file not found: {}. Launch {} once to create it.'],
    ['fichier introuvable : {}. Ouvre une fois les réglages manette de Dolphin pour le créer.', "file not found: {}. Open Dolphin's controller settings once to create it."],
    ['{} est ouvert : ferme-le avant de le mettre à jour.', '{} is open: close it before updating.'], ['{} est ouvert : ferme-le avant de modifier.', '{} is open: close it before editing.'],
    ['RetroAchievements a répondu {}', 'RetroAchievements replied {}'], ['GitHub a répondu {}', 'GitHub replied {}'], ['Exécutable introuvable : {}', 'Executable not found: {}'],
    ['réglage inconnu : {}', 'unknown setting: {}'], ['{} min', '{} min'], ['Manette {}', 'Controller {}'], ['Pavé {}', 'Numpad {}'], ['{} de jeu', '{} played'], ['{} en jeu', '{} in game'], ['{} ({})', '{} ({})'],
  ];
  // préfixes « Libellé : suite » (la suite est traduite si possible)
  const PRE = ['Erreur :', 'Impossible :', 'Échec :', 'Connecté :', 'Fichier refusé :', 'Export impossible :', 'Import impossible :', 'Restauration impossible :', 'Recherche impossible :',
    'Mise à jour impossible :', 'Version installée :', 'keys.txt non importé :', 'Sauvegardes non synchronisées :', 'Réglages non enregistrés :', 'Sauvegardes de', 'Déjà dans Emuglob : sauvegarde du',
    'Membre depuis le', 'Débloqué le', 'Ajouté le'];
  const PREEN = { 'Erreur :': 'Error:', 'Impossible :': 'Failed:', 'Échec :': 'Failed:', 'Connecté :': 'Connected:', 'Fichier refusé :': 'File rejected:', 'Export impossible :': 'Export failed:',
    'Import impossible :': 'Import failed:', 'Restauration impossible :': 'Restore failed:', 'Recherche impossible :': 'Check failed:', 'Mise à jour impossible :': 'Update failed:',
    'Version installée :': 'Installed version:', 'keys.txt non importé :': 'keys.txt not imported:', 'Sauvegardes non synchronisées :': 'Saves not synced:', 'Réglages non enregistrés :': 'Settings not saved:',
    'Sauvegardes de': 'Saves of', 'Déjà dans Emuglob : sauvegarde du': 'Already in Emuglob: save from', 'Membre depuis le': 'Member since', 'Débloqué le': 'Unlocked on', 'Ajouté le': 'Added on' };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PR = P.map(([fr, en]) => [new RegExp('^' + fr.split('{}').map(esc).join('([\\s\\S]*?)') + '$'), en]).sort((a, b) => b[0].source.length - a[0].source.length);
  const cache = new Map();

  function core(s) {
    if (Object.prototype.hasOwnProperty.call(D, s)) return D[s];
    if (s.includes('\n')) return s.split('\n').map((l) => tr(l)).join('\n');
    for (const p of PRE) if (s.startsWith(p + ' ') || s === p) return PREEN[p] + (s.length > p.length ? ' ' + tr(s.slice(p.length + 1)) : '');
    for (const [re, en] of PR) {
      const m = re.exec(s);
      if (!m) continue;
      const g = m.slice(1).map((x) => tr(x));
      if (typeof en === 'function') return en(g);
      let i = 0;
      return en.replace(/\{(\d*)\}/g, (_, n) => (n ? g[+n - 1] : g[i++]) ?? '');
    }
    if (s.includes(' · ')) { const parts = s.split(' · '); const t = parts.map((x) => tr(x)); if (t.some((x, k) => x !== parts[k])) return t.join(' · '); }
    const sent = s.split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ý«])/);   // plusieurs phrases dans un même texte
    if (sent.length > 1) { const t = sent.map((x) => tr(x)); if (t.some((x, k) => x !== sent[k])) return t.join(' '); }
    return s;
  }
  function tr(s) {
    if (typeof s !== 'string' || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
    let r = cache.get(s);
    if (r !== undefined) return r;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    r = m[2] ? m[1] + core(m[2]) + m[3] : s;
    if (cache.size > 5000) cache.clear();
    cache.set(s, r);
    return r;
  }
  window.T = tr;

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const skip = (el) => !el || el.closest('[translate="no"],script,style,textarea,code');
  function node(n) {
    if (n.nodeType === 3) {
      if (skip(n.parentElement)) return;
      const v = n.nodeValue, t = tr(v);
      if (t !== v) n.nodeValue = t;
      return;
    }
    if (n.nodeType !== 1 || skip(n)) return;
    for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) n.value = tr(n.value);
    for (let c = n.firstChild; c; c = c.nextSibling) node(c);
  }
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(node);
      else if (m.type === 'characterData') node(m.target);
      else if (m.type === 'attributes') node(m.target);
    }
  });
  const start = () => { node(document.body); document.title = tr(document.title); obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  const oc = window.confirm.bind(window), oa = window.alert.bind(window);
  window.confirm = (m) => oc(tr(String(m)));
  window.alert = (m) => oa(tr(String(m)));
})();
