'use strict';

/**
 * The categories every model is sorted into: a Category and one of its Subcategories (MakerWorld's
 * own list, so MakerWorld models bring theirs). The words of each are what point to it in folder
 * names, tags and model names when no AI service sorts the models (category-scan.js); a model's
 * longest matching phrase wins. Every Category has an "Other …" Subcategory for the models that
 * fit no other.
 */

/** @type {{ name: string, keywords: string[], subcategories: { name: string, keywords: string[] }[] }[]} */
const CATEGORY_LIST = [
  {
    name: 'Art',
    keywords: ['art', 'artwork'],
    subcategories: [
      { name: '2D Art', keywords: ['2d art', 'wall art', 'painting', 'drawing', 'poster', 'line art', 'silhouette', 'string art'] },
      { name: 'Coin & Badges', keywords: ['coin', 'badge', 'medal', 'challenge coin', 'medallion'] },
      { name: 'Signs & Logos', keywords: ['sign', 'logo', 'nameplate', 'name plate', 'plaque', 'emblem', 'lettering', 'door sign'] },
      { name: 'Sculptures', keywords: ['sculpture', 'statue', 'bust', 'carving'] },
      { name: 'Other Art Models', keywords: [] }
    ]
  },
  {
    name: 'Fashion',
    keywords: ['fashion', 'wearable', 'accessory'],
    subcategories: [
      { name: 'Bags', keywords: ['bag', 'purse', 'wallet', 'handbag', 'backpack', 'pouch'] },
      { name: 'Clothes', keywords: ['clothes', 'clothing', 'shirt', 'dress', 'hat', 'belt buckle', 'button', 'zipper pull'] },
      { name: 'Earrings', keywords: ['earring', 'ear ring', 'ear stud'] },
      { name: 'Footwear', keywords: ['shoe', 'sandal', 'boot', 'slipper', 'footwear', 'sneaker', 'shoe insole'] },
      { name: 'Glasses', keywords: ['glasses', 'sunglasses', 'eyewear', 'spectacles', 'glasses frame'] },
      { name: 'Jewelry', keywords: ['jewelry', 'jewellery', 'necklace', 'pendant', 'bracelet', 'brooch', 'bangle', 'charm'] },
      { name: 'Rings', keywords: ['finger ring', 'wedding ring', 'engagement ring', 'ring size', 'signet ring'] },
      { name: 'Other Fashion Models', keywords: [] }
    ]
  },
  {
    name: 'Hobby & DIY',
    keywords: ['hobby', 'diy', 'maker'],
    subcategories: [
      { name: 'Electronics', keywords: ['electronics', 'raspberry pi', 'arduino', 'pcb', 'esp32', 'circuit', 'project box', 'electronics enclosure'] },
      { name: 'Music', keywords: ['music', 'guitar', 'instrument', 'speaker', 'headphone', 'ukulele', 'drum', 'flute', 'violin', 'guitar pick'] },
      { name: 'RC', keywords: ['rc', 'remote control', 'drone', 'fpv', 'quadcopter', 'rc car', 'rc plane'] },
      { name: 'Robotics', keywords: ['robot', 'robotics', 'robotic arm', 'servo'] },
      {
        name: 'Sport & Outdoors',
        keywords: ['sport', 'outdoor', 'camping', 'fishing', 'bike', 'bicycle', 'hiking', 'golf', 'ski', 'climbing', 'kayak', 'fitness']
      },
      { name: 'Vehicles', keywords: ['vehicle', 'car', 'truck', 'motorcycle', 'tractor', 'train', 'airplane', 'aircraft', 'boat', 'ship', 'tank', 'rocket'] },
      { name: 'Other Hobby & DIY', keywords: [] }
    ]
  },
  {
    name: 'Household',
    keywords: ['household', 'home', 'house'],
    subcategories: [
      { name: 'Decor', keywords: ['decor', 'decoration', 'vase', 'lamp', 'lampshade', 'candle holder', 'picture frame', 'wall decor', 'coaster'] },
      {
        name: 'Festivities',
        keywords: ['christmas', 'halloween', 'easter', 'birthday', 'valentine', 'ornament', 'advent', 'holiday', 'festive', 'party', 'xmas']
      },
      { name: 'Garden', keywords: ['garden', 'planter', 'flower pot', 'plant pot', 'bird feeder', 'birdhouse', 'hose', 'watering'] },
      { name: 'Office', keywords: ['office', 'desk', 'pen holder', 'pencil holder', 'monitor', 'keyboard', 'laptop stand', 'business card', 'stationery'] },
      { name: 'Pets', keywords: ['pet', 'dog bowl', 'cat toy', 'pet feeder', 'aquarium', 'leash', 'litter', 'bird cage', 'hamster', 'cat tree'] },
      { name: 'Other House Models', keywords: ['kitchen', 'bathroom', 'furniture', 'hook', 'hanger', 'shelf', 'soap', 'towel'] }
    ]
  },
  {
    name: 'Education',
    keywords: ['education', 'educational', 'learning', 'school', 'teaching', 'science'],
    subcategories: [
      { name: 'Biology', keywords: ['biology', 'anatomy', 'skull', 'cell', 'dna', 'skeleton', 'organ', 'brain'] },
      { name: 'Chemistry', keywords: ['chemistry', 'molecule', 'molecular', 'atom', 'periodic table'] },
      { name: 'Engineering', keywords: ['engineering', 'gearbox', 'mechanism', 'planetary gear', 'linkage', 'engine model', 'gear'] },
      { name: 'Geography', keywords: ['geography', 'map', 'globe', 'topographic', 'topography', 'continent', 'relief map'] },
      { name: 'Mathematics', keywords: ['math', 'mathematics', 'geometry', 'polyhedron', 'fractal', 'abacus', 'fraction'] },
      { name: 'Physics & Astronomy', keywords: ['physics', 'astronomy', 'planet', 'solar system', 'moon', 'telescope', 'orrery', 'pendulum'] },
      { name: 'Other Education Models', keywords: [] }
    ]
  },
  {
    name: 'Miniatures',
    keywords: ['miniature', 'warhammer', 'dnd', 'd and d', 'dungeons and dragons', 'tabletop', 'wargame', 'wargaming', 'diorama'],
    subcategories: [
      {
        name: 'Animals',
        keywords: ['animal', 'dog', 'cat', 'horse', 'bird', 'fish', 'bear', 'lion', 'dinosaur', 'elephant', 'owl', 'fox', 'rabbit', 'frog', 'turtle']
      },
      { name: 'Architecture', keywords: ['architecture', 'building', 'castle', 'tower', 'bridge', 'temple', 'church', 'terrain'] },
      { name: 'Creatures', keywords: ['creature', 'dragon', 'monster', 'demon', 'alien', 'orc', 'goblin', 'undead', 'beast', 'troll', 'kraken'] },
      { name: 'People', keywords: ['people', 'person', 'human', 'soldier', 'knight', 'warrior', 'wizard', 'figure'] },
      { name: 'Other Miniatures', keywords: [] }
    ]
  },
  {
    name: 'Tools',
    keywords: ['tool', 'workshop'],
    subcategories: [
      { name: 'Gadgets', keywords: ['gadget', 'phone holder', 'phone stand', 'bottle opener', 'cable clip', 'headphone stand'] },
      { name: 'Hand Tools', keywords: ['hand tool', 'wrench', 'screwdriver', 'hammer', 'pliers', 'spanner', 'clamp', 'knife'] },
      { name: 'Machine Tools', keywords: ['machine tool', 'lathe', 'cnc', 'drill guide', 'jig', 'router', 'mill', 'vise', 'vice'] },
      { name: 'Measure Tools', keywords: ['measure', 'measuring', 'ruler', 'caliper', 'gauge', 'protractor', 'tape measure'] },
      { name: 'Medical Tools', keywords: ['medical', 'prosthetic', 'prosthesis', 'splint', 'pill', 'syringe', 'inhaler', 'hearing aid'] },
      { name: 'Organizers', keywords: ['organizer', 'organiser', 'gridfinity', 'storage', 'drawer', 'bin', 'tray', 'rack', 'storage box'] },
      { name: 'Other Tools', keywords: [] }
    ]
  },
  {
    name: 'Toys & Games',
    keywords: ['toy', 'game'],
    subcategories: [
      { name: 'Board Games', keywords: ['board game', 'chess', 'dice', 'card game', 'game piece', 'meeple', 'checkers', 'backgammon'] },
      { name: 'Characters', keywords: ['character', 'pokemon', 'mario', 'pikachu', 'action figure', 'anime', 'cartoon', 'flexi', 'articulated'] },
      { name: 'Outdoor Toys', keywords: ['outdoor toy', 'frisbee', 'kite', 'water gun', 'sandbox', 'glider', 'boomerang'] },
      { name: 'Puzzles', keywords: ['puzzle', 'maze', 'brain teaser', 'jigsaw', 'labyrinth', 'rubik'] },
      { name: 'Construction Sets', keywords: ['construction set', 'lego', 'building block', 'brick', 'marble run', 'construction kit'] },
      { name: 'Other Toys & Games', keywords: ['fidget', 'spinner', 'fidget toy'] }
    ]
  },
  {
    name: '3D Printer',
    keywords: ['3d printer', '3d printing', 'printer'],
    subcategories: [
      {
        name: '3D Printer Accessories',
        keywords: ['spool holder', 'filament', 'filament dryer', 'printer enclosure', 'printer accessory', 'printer upgrade', 'scraper', 'nozzle holder']
      },
      {
        name: '3D Printer Parts',
        keywords: ['printer part', 'extruder', 'hotend', 'fan duct', 'nozzle', 'voron', 'ender', 'prusa', 'bambu', 'bowden', 'x carriage', 'belt tensioner']
      },
      {
        name: 'Test Models',
        keywords: ['benchy', 'calibration', 'test print', 'calibration cube', 'temperature tower', 'torture test', 'overhang test', 'tolerance test']
      }
    ]
  },
  {
    name: 'Props & Cosplays',
    keywords: ['prop', 'cosplay', 'replica'],
    subcategories: [
      { name: 'Costumes', keywords: ['costume', 'armor', 'armour', 'gauntlet', 'chest plate', 'bracer', 'wings'] },
      { name: 'Masks & Helmets', keywords: ['mask', 'helmet', 'visor'] },
      { name: 'Cosplay Weapons', keywords: ['sword', 'blaster', 'lightsaber', 'gun', 'rifle', 'pistol', 'axe', 'shield', 'dagger', 'katana', 'staff'] },
      { name: 'Other Props & Cosplays', keywords: [] }
    ]
  },
  {
    name: 'Generative 3D Model',
    keywords: ['generative', 'makerlab', 'maker lab', 'generated'],
    subcategories: [
      { name: 'Hueforge & Lithophane', keywords: ['hueforge', 'lithophane'] },
      { name: 'Make My Sign', keywords: ['make my sign'] },
      { name: 'Make My Vase', keywords: ['make my vase'] },
      { name: 'Pixel Puzzle Maker', keywords: ['pixel puzzle'] },
      { name: 'Relief Sculpture Maker', keywords: ['relief sculpture'] },
      { name: 'AI Scanner', keywords: ['ai scanner', 'ai scan'] },
      { name: 'Image to Keychain', keywords: ['image to keychain'] },
      { name: 'Make My Desk Organizer', keywords: ['make my desk organizer'] },
      { name: 'PrintMon Maker', keywords: ['printmon'] },
      { name: 'Statue Maker', keywords: ['statue maker'] },
      { name: 'Christmas Ornament Maker', keywords: ['christmas ornament maker', 'ornament maker'] },
      { name: 'Make My Lantern', keywords: ['make my lantern'] }
    ]
  }
];

/** Category names other sites use that mean one of these (Printables, Thingiverse). */
const SITE_SYNONYMS = {
  '3d printers': '3D Printer',
  '3d printing': '3D Printer',
  '3d printer extruders': '3D Printer Parts',
  '3d printer parts': '3D Printer Parts',
  '3d printer accessories': '3D Printer Accessories',
  'test models': 'Test Models',
  'art and design': 'Art',
  art: 'Art',
  '2d art': '2D Art',
  sculptures: 'Sculptures',
  'signs and logos': 'Signs & Logos',
  learning: 'Education',
  biology: 'Biology',
  chemistry: 'Chemistry',
  engineering: 'Engineering',
  geography: 'Geography',
  math: 'Mathematics',
  mathematics: 'Mathematics',
  'physics and astronomy': 'Physics & Astronomy',
  'costumes and accessories': 'Props & Cosplays',
  costumes: 'Costumes',
  masks: 'Masks & Helmets',
  props: 'Props & Cosplays',
  'hobby and makers': 'Hobby & DIY',
  hobby: 'Hobby & DIY',
  electronics: 'Electronics',
  music: 'Music',
  'rc and robotics': 'Hobby & DIY',
  robotics: 'Robotics',
  'sports and outdoors': 'Sport & Outdoors',
  'outdoor and garden': 'Garden',
  garden: 'Garden',
  household: 'Household',
  'home decor': 'Decor',
  decorations: 'Decor',
  office: 'Office',
  pets: 'Pets',
  holidays: 'Festivities',
  gadgets: 'Gadgets',
  tools: 'Tools',
  'hand tools': 'Hand Tools',
  organizers: 'Organizers',
  medical: 'Medical Tools',
  'toys and games': 'Toys & Games',
  'board games': 'Board Games',
  puzzles: 'Puzzles',
  models: 'Miniatures',
  miniatures: 'Miniatures',
  animals: 'Animals',
  architecture: 'Architecture',
  creatures: 'Creatures',
  people: 'People',
  fashion: 'Fashion',
  jewelry: 'Jewelry'
};

module.exports = { CATEGORY_LIST, SITE_SYNONYMS };
