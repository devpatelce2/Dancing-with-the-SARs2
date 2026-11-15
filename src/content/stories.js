// Site stories shown in the "Story" tab. Background text is written by the team from the listed sources;
// every number about OUR results is computed live from the site's timeseries.json (see storyFindings), never typed in here.
const HAOR = {
  kind: 'flood', label: 'Flood', place: 'Sylhet haors, Bangladesh',
  title: 'The wetlands that breathe',
  subtitle: 'A monsoon season in the haors of north-east Bangladesh, seen by radar',
  facts: [['860,000 ha', 'Haor Basin', 1], ['20 million+', 'people live there', 1], ['Jun to Oct', 'flood season', 4], ['12 days', 'NISAR repeat', 9]],
  chapters: [
    { id: 'land', heading: 'A landscape built to flood', figure: null,
      text: [
        'North-east Bangladesh holds the Haor Basin, a geological depression of about 860,000 hectares where more than 20 million people live [1]. Indian hill ranges close it in on three sides, with Meghalaya, India\'s wettest region, to the north [2][3].',
        'In the monsoon, runoff from rivers and canals turns the haors into wide stretches of water [2]. Flooding lasts from about June to October, so most farmers can grow only one crop a year: boro rice [4], planted in December and January and harvested in April and May [5].',
        'The risk is at harvest. On 28 April 2026, water from upstream surged into the basin while rice was still in the fields [6].',
      ] },
    { id: 'dark', heading: 'Why water looks dark', figure: 'specular',
      text: ['NISAR sends its own radar pulse and measures what returns. A smooth surface reflects the pulse away from the sensor, so little energy comes back and the surface looks dark [7]. Calm open water does this. Our app looks for pixels that became clearly darker than in the reference scenes.'] },
    { id: 'bright', heading: 'Why some flooding looks brighter', figure: 'double',
      text: ['Water under plants does the opposite. The pulse bounces twice, off the water and off a stem or trunk, and returns to the satellite, so flooded tall vegetation is bright [8]. NISAR\'s L-band wavelength reaches further into vegetation than C-band sensors [8]. That is why our difference map has two colours: red for darker, blue for brighter.'] },
    { id: 'saw', heading: 'What we saw', figure: 'findings', text: [] },
    { id: 'question', heading: 'A question for the data', figure: null,
      text: ['The number of crop-protection dams in Sunamganj\'s haors is growing, and that has raised concern [1]. Do embankments change where the water goes and how long it stays? A multi-year NISAR record could test that. We have not tested it here.'] },
    { id: 'next', heading: 'What NISAR makes possible', figure: null,
      text: ['NISAR works day and night, through cloud, on a 12-day exact repeat [9]. NASA describes "uniquely detailed monitoring of the seasonal ebb and flow of flood waters" in wetlands [10], and expects the data to help crop management and show how wetlands and farmland change [11]. For the haors that means following each flood pass by pass, and the single rice crop from planting to harvest.'] },
  ],
  sources: [
    ['UNB: Sunamganj haors', 'https://unb.com.bd/news/tag/31190'],
    ['MDPI: haor agriculture review', 'https://mdpi.com/2673-4133/5/2/17'],
    ['Millennium Post: Working in tandem', 'https://www.millenniumpost.in/opinion/opinion-245929'],
    ['Bangladesh J. Nuclear Agriculture: haor cropping study', 'https://banglajol.info/index.php/BJNAg/article/download/83402/54778'],
    ['The Daily Star: Can Bangladesh save its haor food bowl?', 'https://online-d11.thedailystar.net/slow-reads/big-picture/news/can-bangladesh-save-its-haor-food-bowl-4181841'],
    ['Daily Observer: April 2026 haor floods', 'https://observerbd.com/news/575974'],
    ['Natural Resources Canada: radar target interaction', 'https://natural-resources.canada.ca/node/9311'],
    ['NISAR StoryMap: floods and wetlands', 'https://storymaps.arcgis.com/stories/c00d7691b8004b20a14f28df710d05fd'],
    ['NASA ARSET 2026: NISAR training, part 1', 'https://www.earthdata.nasa.gov/s3fs-public/2026-06/arset-2026-nisar-part1.pdf'],
    ['NASA: NISAR applications, floods', 'https://assets.science.nasa.gov/content/dam/science/missions/nisar/nisar-jpl/pdf/NISAR_Applications_Floods.pdf'],
    ['NASA: 5 things to know about NISAR', 'https://www.nasa.gov/missions/nisar/5-things-to-know-about-powerful-new-u-s-india-satellite-nisar/'],
  ],
}


const NOTO = {
  kind: 'earthquake', label: 'Earthquake', place: 'Noto Peninsula, Japan',
  title: 'The day the coast rose',
  subtitle: 'The 1 January 2024 Noto Peninsula earthquake, and what radar brightness can and cannot show',
  facts: [['M 7.5', 'magnitude (Major)', 1], ['50 s', 'of violent shaking', 1], ['4 m', 'largest coastal uplift', 1], ['85 km', 'of coast lifted', 1]],
  chapters: [
    { id: 'quake', heading: 'New Year\'s Day, 2024', figure: null,
      text: ['At 4:10 p.m. on 1 January 2024 a magnitude 7.5 earthquake shook Japan\'s Noto Peninsula for about 50 seconds [1]. It was the strongest to hit Ishikawa Prefecture since 1885 [1]. Shaking was most intense in Suzu, Noto, Wajima and Anamizu, and damaged infrastructure started fires that burned through communities [1]. Landslides and rockfalls cut the road network [2].'] },
    { id: 'uplift', heading: 'The land rose', figure: 'uplift',
      text: ['The north coast moved upward by as much as 4 metres [1]. Land was lifted along about 85 km of coastline, and roughly 4.4 square kilometres of former seabed became dry land [1]. In places the shoreline moved up to 200 m seaward, a shift visible in radar and aerial images [2].'] },
    { id: 'how', heading: 'How radar measures moving ground', figure: null,
      text: [
        'Scientists mapped this uplift from space with L-band radar from Japan\'s ALOS-2 satellite, by tracking how far each patch of ground had shifted between two passes [1][3]. NISAR carries the same kind of L-band radar, and its displacement product is built for exactly this job [4].',
        'Our app does something simpler. It compares radar brightness between dates. Brightness does not measure how far the ground moved, so this page cannot show the uplift itself.',
      ] },
    { id: 'saw', heading: 'What we saw', figure: 'findings',
      text: ['Brightness can still change after an earthquake where slopes fail, buildings collapse or burn, or seabed becomes land. Brighter pixels on a coast would be the place to look for new land. We have not confirmed any of these in our area.'] },
    { id: 'next', heading: 'What NISAR adds', figure: null,
      text: ['This earthquake happened before NISAR began collecting data in August 2025 [5], so this site uses Sentinel-1. NISAR now images the same ground twice every 12 days and can detect subtle motion such as slip along faults [6]. For the next large earthquake, a before-and-after pair should already be in the archive.'] },
  ],
  sources: [
    ['NASA Earth Observatory: Earthquake Lifts the Noto Peninsula', 'https://earthobservatory.nasa.gov/images/152350/earthquake-lifts-the-noto-peninsula'],
    ['JpGU 2024, U16-05: The 2024 Noto Peninsula Earthquake', 'https://pub-files.atlas.jp/fs/public/jpgu2024/ver_3/abstract/en/U16-05.pdf'],
    ['SSA 2024: Geodetically estimated ground displacement of the Noto earthquake', 'https://seismosoc.secure-platform.com/a/solicitations/35/sessiongallery/908/application/11830'],
    ['NISAR Data User Guide: products overview', 'https://nisar-docs.asf.alaska.edu/products-overview/'],
    ['NISAR Data User Guide: data availability', 'https://nisar-docs.asf.alaska.edu/availability-overview/'],
    ['NASA: NASA-ISRO satellite captures Pacific Northwest through clouds', 'https://www.nasa.gov/missions/nisar/nasa-isro-satellite-captures-pacific-northwest-through-clouds'],
  ],
}

const COTTONWOOD = {
  kind: 'wildfire', label: 'Wildfire', place: 'Cottonwood Fire, Utah, USA',
  bounds: [-112.5, 38.22, -112.26, 38.42],
  process: 'python -m pipeline.quick --site-id cottonwood-fire --name "Cottonwood Fire" --event "Cottonwood Fire 2026" --country US --bbox -112.50 38.22 -112.26 38.42 --start 2026-05-15 --end 2026-09-30 --event-date 2026-06-23 --pol HVHV --threshold-db -1.5',
  processNote: 'The box is centred on the position NASA gives for the fire [1]; check it against the official fire perimeter. If NISAR has too few scenes before the fire, add --mission sentinel1 and remove --pol.',
  title: 'After the smoke',
  subtitle: 'The 2026 Cottonwood Fire in Utah, and how radar sees a burn scar',
  facts: [['390 km²', 'burned by 7 July', 1], ['3×', 'growth in 12 hours', 1], ['150', 'structures lost (up to)', 1], ['1.5 dB', 'radar drop that flags a burn', 5]],
  chapters: [
    { id: 'fire', heading: 'A fire in a record year', figure: null,
      text: [
        'In June 2026 a fire that began as a small patch near Beaver, Utah, ran through the mountains along the Beaver River [1]. It spread fastest on 23 and 26 June, and on 23 June it tripled in size in 12 hours [1]. By 7 July it covered about 390 square kilometres and was 56 percent contained [1].',
        'Up to 150 structures were destroyed, and the Eagle Point ski resort lost more than 100 condos and 30 cabins [1]. Utah went on to set a record for forest and woodland burned in one year [2]. Across the United States, more land had burned by early September than by that date in any of the previous ten years [3].',
      ] },
    { id: 'fuel', heading: 'What burned', figure: 'canopy',
      text: ['The fire burned ponderosa pine, oak, sagebrush and grasses [1]. To radar, a living forest is a deep tangle of branches. The pulse scatters many times inside the canopy, and a good share of it returns to the satellite.'] },
    { id: 'scar', heading: 'How radar sees a burn scar', figure: 'burnt',
      text: [
        'When the canopy burns away, that scattering inside the vegetation drops, and the burn scar turns darker in the radar image [4]. Radar also sees through the smoke [4].',
        'The effect is clearest in the cross-polarised channel, HV. In a study with NASA\'s airborne L-band radar, a drop of 1.5 dB in HV picked out a Los Angeles burn scar with an accuracy of 0.70 against the official fire perimeter [5]. That is why this site is set up to use HV with a 1.5 dB threshold. It is a starting point from another fire, not a tuned value.',
      ] },
    { id: 'saw', heading: 'What we saw', figure: 'findings', text: [] },
    { id: 'question', heading: 'A question for the data', figure: null,
      text: ['How fast does a burned forest come back? Radar can track recovery by vegetation type [5]. A year of NISAR passes over this scar could show which slopes regrow first. We have not tested that.'] },
    { id: 'next', heading: 'What NISAR makes possible', figure: null,
      text: ['NASA expects NISAR to help map burned area even where other methods struggle, and to estimate the fuel available to burn before a fire starts [6]. With a pass every 12 days, day or night and through smoke, a burn scar can be mapped while the fire is still active.'] },
  ],
  sources: [
    ['NASA Earth Observatory: Cottonwood Fire Chars Utah', 'https://science.nasa.gov/earth/earth-observatory/cottonwood-fire-chars-utah/'],
    ['KSL: Utah sets new record for woodland area lost to wildfires', 'https://www.ksl.com/article/news/utah/environment/utah-sets-new-record-for-woodland-area-lost-to-wildfires-by-a-wide-margin-u-researchers-say/51606308'],
    ['Newsweek: US wildfires hit highest acreage burned in a decade', 'https://www.newsweek.com/us-wildfires-hit-highest-acreage-burned-in-a-decade-12409322'],
    ['NASA JPL Radar Science: hazards', 'https://www.jpl.nasa.gov/go/radar-science/hazards/'],
    ['An, Jones and Lou: pre- and post-fire fuel with L-band polarimetric SAR', 'https://www.citedrive.com/en/discovery/assessment-of-pre-and-postfire-fuel-availability-for-wildfire-management-based-on-lband-polarimetric-sar'],
    ['NASA: NISAR applications, fire management', 'https://assets.science.nasa.gov/content/dam/science/missions/nisar/nisar-jpl/pdf/NISAR_Applications_Fire_Management1.pdf'],
  ],
}

const WAYANAD = {
  kind: 'landslide', label: 'Landslide', place: 'Wayanad, Kerala, India',
  bounds: [76.09, 11.43, 76.19, 11.53],
  process: 'python -m pipeline.quick --site-id wayanad --name "Wayanad" --event "Wayanad landslides 2024" --country IN --bbox 76.09 11.43 76.19 11.53 --mission sentinel1 --start 2024-06-15 --end 2024-09-15 --event-date 2024-07-30 --threshold-db -3',
  processNote: 'The box covers the landslide crown [3] and the villages downstream. This event is before NISAR, so the command uses Sentinel-1; we have not checked that Sentinel-1 scenes are available for this box.',
  title: 'Eight kilometres in the dark',
  subtitle: 'The 30 July 2024 Wayanad landslides, and why radar was the first eye on the slope',
  facts: [['586 mm', 'rain in two days', 3], ['8 km', 'debris flow', 5], ['86,000 m²', 'main scarp', 5], ['250+', 'lives lost', 2]],
  chapters: [
    { id: 'night', heading: 'The night of 30 July 2024', figure: null,
      text: ['In the early hours of 30 July 2024, landslides struck the villages of Mundakkai and Chooralmala in Wayanad district, Kerala, burying whole neighbourhoods under mud and debris [1]. The nearest weather station had recorded 586 mm of rain over 29 and 30 July [3]. More than 250 people died [2].'] },
    { id: 'flow', heading: 'Eight kilometres of debris', figure: 'scar',
      text: ['The slide began high on the hill, at about 1,550 metres [4]. India\'s National Remote Sensing Centre measured the main scarp at 86,000 square metres and the debris flow at about 8 km long. The flow widened the course of the river and broke its banks, and the crown was a reactivation of an older landslide [5]. A similar slide at Puthumala, 2 to 3 km away, killed 17 people in 2019 [6].'] },
    { id: 'radar', heading: 'Why radar was the first eye', figure: null,
      text: [
        'Optical satellite pictures are extremely hard to get in the monsoon, because of cloud [7]. The first full view of the debris flow, from crown to the end of the run-out, came from an Indian radar satellite on 31 July [5].',
        'We expect a slide to change the radar echo in both directions. Forest that was scattering the pulse is gone, and fresh rock and mud can be rougher or smoother than what they replaced. So for this site we watch both colours of the difference map, not only the darker one. That is our expectation, not a measured result.',
      ] },
    { id: 'saw', heading: 'What we saw', figure: 'findings',
      text: ['A caution on size: the main scarp is 86,000 square metres, which is about 95 Sentinel-1 pixels of 30 m. The run-out is long but narrow. A slide this size is close to the limit of what this method can show.'] },
    { id: 'question', heading: 'A question for the data', figure: null,
      text: ['The crown had failed before [5]. Could regular radar passes have shown that slope creeping in the weeks before it gave way? NASA says NISAR should detect slow-moving landslides and may give forewarning of rapid ones [8]. That needs the displacement product, which this app does not use yet.'] },
    { id: 'next', heading: 'What NISAR makes possible', figure: null,
      text: ['Landslides kill between 2,000 and 3,000 people around the world every year [8]. Landslide studies were one of the applications India\'s space agency named for the joint mission [9]. NISAR images nearly all land through cloud every 12 days, which covers the monsoon weeks when slopes fail and optical satellites see only cloud.'] },
  ],
  sources: [
    ['The Wire: Nightmare in Wayanad', 'https://m.thewire.in/article/environment/nightmare-in-wayanad-torrential-rains-triggered-landslides-but-climate-change-may-not-be-the-sole-culprit/amp'],
    ['The News Minute: ISRO releases images before and after Wayanad landslides', 'https://thenewsminute.com/kerala/isro-releases-images-before-and-after-wayanad-landslides'],
    ['Yunus et al.: Documenting the most disastrous landslide of 30 July 2024, Wayanad', 'https://nora.nerc.ac.uk/id/eprint/539430/1/Documenting_Wayanad_LASL_R1.pdf'],
    ['Asianet Newsable: ISRO satellite images show extent of damage', 'https://newsable.asianetnews.com/amp/india/wayanad-landslides-isro-s-satellite-image-show-extent-of-damage-crown-of-1550m-debris-travelled-8km-along-snt-shkvt4'],
    ['Outlook India: satellite map shows crown of landslide (NRSC)', 'https://www.outlookindia.com/national/wayanad-landslides-isro-nsrc-satellite-images-landslide-impact-chooralmala-iruvaniphuza-river'],
    ['Mongabay India: On the trail of the Wayanad landslide', 'https://india.mongabay.com/2024/08/commentary-on-the-trail-of-the-wayanad-landslide/'],
    ['Eos, The Landslide Blog: Wayanad landslides', 'https://eos.org/thelandslideblog/wayanad-landslides'],
    ['NASA: NISAR applications, landslides', 'https://assets.science.nasa.gov/content/dam/science/missions/nisar/nisar-jpl/pdf/NISAR_Applications_Landslides.pdf'],
    ['eoPortal: NISAR', 'https://www.eoportal.org/satellite-missions/nisar'],
  ],
}

export const STORIES = { sylhet: HAOR, sunamganj: HAOR, 'noto-peninsula': NOTO, 'cottonwood-fire': COTTONWOOD, wayanad: WAYANAD }
export const storyFor = (siteId) => STORIES[siteId] ?? null

/** One main case study per kind of change, in display order. `siteIds` are tried in order; the first one that has processed
 *  radar data opens with its charts. If none has data yet, the story still opens, clearly marked as not processed. */
export const CASE_STUDIES = [
  { key: 'flood', story: HAOR, siteIds: ['sylhet', 'sunamganj'] },
  { key: 'earthquake', story: NOTO, siteIds: ['noto-peninsula'] },
  { key: 'wildfire', story: COTTONWOOD, siteIds: ['cottonwood-fire'] },
  { key: 'landslide', story: WAYANAD, siteIds: ['wayanad'] },
]
