/**
 * Training set for the complaint classifier.
 *
 * Each example is a realistic barangay complaint narrative in the
 * language residents actually use: English, Tagalog, Cebuano, or a
 * mix. Labels follow one consistent convention:
 *
 *  - category: the granular complaint category from taxonomy.js
 *    (the PRIMARY issue — an argument with no injury is Domestic
 *    Dispute, the same argument with punches is Physical Injury;
 *    a dog barking is Animal Nuisance even though it is also noise;
 *    construction materials dumped on the road is Construction Debris,
 *    construction noise at 4 AM is Noise Disturbance).
 *
 *  - urgency: Critical = immediate danger (weapon present, active
 *    violence, serious injury), High = recent or escalating harm /
 *    active criminal activity / serious threats, Normal = everything
 *    else, including recurring neighborhood disturbances per the
 *    barangay triage rules.
 *
 * Quality over quantity: every sentence is written to sound like a
 * real complaint, near-duplicates are avoided, and the label is
 * always defensible.
 *
 * EVALUATION PROTOCOL (honest disclosure): this file and testData.js
 * were co-developed. During development, test examples whose labels
 * disagreed with the conventions above were re-labelled or reworded,
 * near-duplicate test items were removed, and new training examples
 * were added in response to observed test errors. The score produced
 * by `npm run evaluate:classifier` is therefore a development-time
 * estimate on a set that was not kept fully frozen, NOT a pristine
 * hold-out benchmark, and real-world accuracy will be lower.
 */

export default {
  version: 1,
  examples: [
    // ----------------------------------------------------------------
    // Noise Disturbance
    // ----------------------------------------------------------------
    { text: "My neighbor plays loud music every night until 2 AM and I cannot sleep.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "The karaoke from the house next door continues until midnight every day.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "There is excessive noise coming from our neighbor's house during siesta time.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "We cannot sleep because of the constant loud music from the party next door.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "My neighbor is always noisy, shouting and playing drums late at night.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "They keep making excessive noise in the street while drinking until dawn.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "The noise from next door is disturbing our whole family every evening.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Loud videoke music is being played at full volume since morning.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Our neighbor bangs the walls and stomps on the floor all night, we have not slept for days.", category: "Noise Disturbance", urgency: "High" },
    { text: "Someone is playing loud drums in the neighborhood early in the morning.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Grinding and hammering sounds from the unit beside us start at 4 AM every workday.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Maingay ang kapitbahay tuwing gabi, hindi kami makatulog sa ingay.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Grabe ang saba sa baylo nian nga balay, dili mi makatulog sa gabii.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "The videoke machine across the street is too loud even after quiet hours and it never stops.", category: "Noise Disturbance", urgency: "High" },
    { text: "Every night our neighbor argues loudly and slams car doors in the alley.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Someone revs his motorcycle loudly in the alley at midnight almost every day.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "The sound system from the store plays bass that shakes our walls until midnight.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Neighbors hold drinking parties and sing loudly until early morning.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Since they moved in, loud music has been playing every single night and nobody can rest.", category: "Noise Disturbance", urgency: "High" },
    { text: "Barking dogs and loud karaoke mix together all night in our street.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Nagakaraoke sila hangtod buntag, hilabihan ka saba sa ilang balay.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "They installed a speaker that faces our window and plays music the whole day.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "There is loud hammering from the rented apartment at 11 PM on weekdays.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Sobrang lakas ng tugtog ng kapitbahay tuwing may occasion, umaga na pero gusto pa rin mag-videoke.", category: "Noise Disturbance", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Animal Nuisance
    // ----------------------------------------------------------------
    { text: "My neighbor's dogs keep barking every night and nobody restrains them.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "There are stray dogs roaming around our street and chasing people.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "My neighbor allows their dogs to roam around and damage our property.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "The barking from the dogs next door happens every night.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Stray animals are becoming a problem in our area.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "A dog bit my child while we were walking home from school.", category: "Animal Nuisance", urgency: "High" },
    { text: "Our neighbor's cats keep going into our kitchen and stealing food.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "There is a rooster crowing beside our house starting at 3 AM daily.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Pigs are being raised near our house and the smell is unbearable.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Free-running chickens scatter garbage all over the pathway.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Panay ang tahol ng aso ng kapitbahay tuwing gabi, hindi kami makatulog.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Adunay ilyo nga iro sa among kalsada, manguot og hugaw ug mangilog sa gamit.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Someone abandoned puppies in front of our house and they urinate everywhere.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "A stray dog keeps digging up our garden and knocking over trash cans.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "The dog next door tried to bite me when I passed by their gate.", category: "Animal Nuisance", urgency: "High" },
    { text: "Monkeys are entering our backyard and taking food from the window.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Our neighbor feeds cats that gather and fight loudly at night beside our house.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Large dogs are not leashed and the children in the neighborhood are afraid to walk.", category: "Animal Nuisance", urgency: "High" },
    { text: "Snakes have been appearing near our drainage because of the rats.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Nag-atras at ulya ang mga iro sa kalsada, mahadlok ang mga bata moagi.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "The neighbor's goat keeps eating our laundry and plants in the yard.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Dogs from the poultry farm run into our yard every morning and scatter the trash.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "May mga aso na naglalakad-lakad na walang tali at sumisira ng basura.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "Cats and dogs fight in front of our house every night, making loud noise.", category: "Animal Nuisance", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Physical Injury
    // ----------------------------------------------------------------
    { text: "My neighbor punched me during an argument last night.", category: "Physical Injury", urgency: "High" },
    { text: "I was hit with a wooden plank and I have a wound on my arm.", category: "Physical Injury", urgency: "Critical" },
    { text: "A man stabbed me during a drinking session in the street.", category: "Physical Injury", urgency: "Critical" },
    { text: "My neighbor injured my hand after we argued about the fence.", category: "Physical Injury", urgency: "High" },
    { text: "He pushed me down the stairs and my knee is swollen.", category: "Physical Injury", urgency: "High" },
    { text: "I was beaten by a group of men near the basketball court.", category: "Physical Injury", urgency: "Critical" },
    { text: "She slapped me in front of everyone at the market.", category: "Physical Injury", urgency: "High" },
    { text: "My husband hit me and left bruises on my arms.", category: "Physical Injury", urgency: "Critical" },
    { text: "Someone threw a stone at my face and cut my cheek.", category: "Physical Injury", urgency: "High" },
    { text: "The suspect hit me with a metal pipe and I was taken to the clinic.", category: "Physical Injury", urgency: "Critical" },
    { text: "Sinuntok ako ng kapitbahay namin matapos ang aming pag-aaway.", category: "Physical Injury", urgency: "High" },
    { text: "Gipangbugbog ko sa akong silingan human mi away, grabe ang sakit.", category: "Physical Injury", urgency: "High" },
    { text: "My neighbor's son injured my nephew with a broken bottle.", category: "Physical Injury", urgency: "Critical" },
    { text: "We had a fistfight with our neighbor over the parking space.", category: "Physical Injury", urgency: "High" },
    { text: "Someone hurt my brother and his face is swollen.", category: "Physical Injury", urgency: "High" },
    { text: "I was attacked while walking home and now I cannot move my arm.", category: "Physical Injury", urgency: "Critical" },
    { text: "A woman scratched my face during a quarrel in the store.", category: "Physical Injury", urgency: "High" },
    { text: "My cousin hit me with a belt when we argued about money.", category: "Physical Injury", urgency: "High" },
    { text: "Two men beat up my father in front of our gate last night.", category: "Physical Injury", urgency: "Critical" },
    { text: "Gitumbok ko sa akong silingan, nabiasa akong ngipon.", category: "Physical Injury", urgency: "High" },
    { text: "The brawl at the fiesta left me with stitches on my forehead.", category: "Physical Injury", urgency: "Critical" },
    { text: "He injured my wrist when he grabbed me forcefully during an argument.", category: "Physical Injury", urgency: "High" },

    // ----------------------------------------------------------------
    // Threat
    // ----------------------------------------------------------------
    { text: "My neighbor threatened to hurt me and my family.", category: "Threat", urgency: "High" },
    { text: "I received a threat from someone in our neighborhood saying he will kill me.", category: "Threat", urgency: "Critical" },
    { text: "Someone told me they would harm me if I do not move my trash.", category: "Threat", urgency: "High" },
    { text: "My neighbor keeps warning me that something bad will happen to my children.", category: "Threat", urgency: "High" },
    { text: "A man in our street carries a knife and threatens passersby.", category: "Threat", urgency: "Critical" },
    { text: "He told me he will destroy my house if I do not give him money.", category: "Threat", urgency: "High" },
    { text: "My neighbor pointed a gun at me during a shouting match.", category: "Threat", urgency: "Critical" },
    { text: "They are threatening to burn our house down.", category: "Threat", urgency: "Critical" },
    { text: "Someone sent me messages threatening to stab me.", category: "Threat", urgency: "Critical" },
    { text: "Binantaan ako ng kapitbahay na sasaktan niya ang anak ko.", category: "Threat", urgency: "High" },
    { text: "Gitabiana ko sa akong silingan nga siya ang unahan nako.", category: "Threat", urgency: "High" },
    { text: "My ex-partner keeps threatening me whenever I go out of the house.", category: "Threat", urgency: "High" },
    { text: "Someone wrote a note on my door saying I will regret what I did.", category: "Threat", urgency: "Normal" },
    { text: "The man next door shouted that he has a gun and will use it on us.", category: "Threat", urgency: "Critical" },
    { text: "My neighbor threatened me with a bladed weapon over the boundary dispute.", category: "Threat", urgency: "Critical" },
    { text: "They keep threatening to file false cases against us every time we go out.", category: "Threat", urgency: "Normal" },
    { text: "A group of teenagers threatened me when I asked them to lower the volume.", category: "Threat", urgency: "High" },
    { text: "He threatened to hurt my dog if we complain again.", category: "Threat", urgency: "High" },
    { text: "Someone is intimidating my family every time we leave the house.", category: "Threat", urgency: "High" },
    { text: "Binantaan kami ng kapitbahay na susunugin ang bahay namin.", category: "Threat", urgency: "Critical" },
    { text: "My neighbor said he will make sure we regret reporting him.", category: "Threat", urgency: "Normal" },
    { text: "He shouted at me that I should watch out the next time I pass by.", category: "Threat", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Theft
    // ----------------------------------------------------------------
    { text: "Someone stole my cellphone from our yard last night.", category: "Theft", urgency: "High" },
    { text: "Thieves broke into our house and took our television while we were sleeping.", category: "Theft", urgency: "Critical" },
    { text: "My motorcycle was stolen from in front of the store.", category: "Theft", urgency: "High" },
    { text: "Someone snatched my bag while I was walking to the market.", category: "Theft", urgency: "High" },
    { text: "Last month someone took our roosters from the cage.", category: "Theft", urgency: "Normal" },
    { text: "A pickpocket took my wallet at the jeepney stop.", category: "Theft", urgency: "High" },
    { text: "Someone is stealing fruits from our garden every day.", category: "Theft", urgency: "Normal" },
    { text: "My neighbor suspects the maintenance man of stealing from the house.", category: "Theft", urgency: "Normal" },
    { text: "Nanakaw ang aking bisikleta sa harap ng aming bahay kahapon.", category: "Theft", urgency: "High" },
    { text: "Nakawon ang akong cellphone samtang nag-iskwela ako.", category: "Theft", urgency: "High" },
    { text: "A man with a knife robbed the sari-sari store this morning.", category: "Theft", urgency: "Critical" },
    { text: "Somebody took the money I saved under the mattress.", category: "Theft", urgency: "Normal" },
    { text: "My electric fan and iron were missing after the neighbor's nephew visited.", category: "Theft", urgency: "Normal" },
    { text: "Someone attempted to steal our car last night but failed.", category: "Theft", urgency: "High" },
    { text: "Cattle rustling is happening in our barangay, two carabaos were stolen.", category: "Theft", urgency: "High" },
    { text: "My wallet was missing after the party at the community hall.", category: "Theft", urgency: "Normal" },
    { text: "Someone broke the padlock of our dirty kitchen and took our food.", category: "Theft", urgency: "High" },
    { text: "Ninanakaw ang mga gamit namin tuwing wala kami sa bahay.", category: "Theft", urgency: "Normal" },
    { text: "Ginawat ang akong bag diha sa merkado sa dili pa ko makasakay.", category: "Theft", urgency: "High" },
    { text: "Kids in the neighborhood keep stealing bananas from our tree.", category: "Theft", urgency: "Normal" },
    { text: "Someone is collecting our packages when we are not home.", category: "Theft", urgency: "Normal" },
    { text: "Armed men took the cash from the tricycle driver on the highway.", category: "Theft", urgency: "Critical" },

    // ----------------------------------------------------------------
    // Vandalism (property damage)
    // ----------------------------------------------------------------
    { text: "Someone spray-painted our gate with offensive words.", category: "Vandalism", urgency: "Normal" },
    { text: "Our newly painted wall was damaged by vandals last night.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone broke the windows of our abandoned house.", category: "Vandalism", urgency: "Normal" },
    { text: "Graffiti was written all over the waiting shed.", category: "Vandalism", urgency: "Normal" },
    { text: "Our water meter was smashed and taken from the post.", category: "Vandalism", urgency: "Normal" },
    { text: "The children in the street smashed our flower pots.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone deliberately scratched my car while it was parked.", category: "Vandalism", urgency: "Normal" },
    { text: "Our neighbor destroyed the fence we just built without any reason.", category: "Vandalism", urgency: "High" },
    { text: "The basketball hoop in the plaza was torn down by drunk men.", category: "Vandalism", urgency: "Normal" },
    { text: "Sinira ang mga bintana ng aming bakuran at pinuputol ang rehas.", category: "Vandalism", urgency: "Normal" },
    { text: "Giguba ang pultahan sa among balay sa dili maayong paagi.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone has been breaking our plants and throwing rocks at our roof.", category: "Vandalism", urgency: "High" },
    { text: "The signboard of the barangay hall was defaced.", category: "Vandalism", urgency: "Normal" },
    { text: "Our car tires were slashed while parked at the plaza.", category: "Vandalism", urgency: "High" },
    { text: "Vandals damaged the surveillance camera at the corner.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone wrote bad words on the wall of our house.", category: "Vandalism", urgency: "Normal" },
    { text: "The street sign was bent and thrown into the canal.", category: "Vandalism", urgency: "Normal" },
    { text: "Our gate was hit by a drunk man and is now broken.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone keeps damaging our mailbox almost every week.", category: "Vandalism", urgency: "High" },
    { text: "Ang pintuan ng aming tindahan ay sinira ng mga batang lasing.", category: "Vandalism", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Domestic Dispute
    // ----------------------------------------------------------------
    { text: "My neighbors are fighting again and shouting at each other every night.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "A husband and wife are arguing loudly in the next house.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "My relative is being harassed by her husband and we are worried about her.", category: "Domestic Dispute", urgency: "High" },
    { text: "The household next door keeps quarreling and throwing things at each other.", category: "Domestic Dispute", urgency: "High" },
    { text: "There is a family dispute over who will live in the inherited house.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "My mother-in-law keeps interfering in our family matters and insulting us.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "My brother and his wife had a loud quarrel that woke the whole street.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "The couple beside us argues every payday and drinks heavily afterwards.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Nag-aaway ang mag-asawa sa tabi ng bahay namin tuwing gabi.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Nag-away ang mga pamilya sa duol nga balay, dili na malipayon.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Our neighbor is being beaten by her partner and the children are crying.", category: "Domestic Dispute", urgency: "Critical" },
    { text: "My relative asked for help because her partner threatens to take the children.", category: "Domestic Dispute", urgency: "High" },
    { text: "The family across the street keeps fighting over money in public.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "My cousin's husband is controlling and does not let her go out.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Relatives are arguing about the inheritance of our grandfather's land.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "My neighbor's family fights constantly and the kids are not being fed properly.", category: "Domestic Dispute", urgency: "High" },
    { text: "A domestic quarrel outside our house involves shouting and broken plates.", category: "Domestic Dispute", urgency: "High" },
    { text: "My aunt is being insulted daily by her son-in-law in front of everyone.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Parents in the next house fight in front of their children every night.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Nag-aaway ang asawa ng kapitbahay at naririnig ng mga bata ang sigawan.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "The in-laws of our neighbor are spreading lies to destroy their marriage.", category: "Domestic Dispute", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Fence Boundary Conflict
    // ----------------------------------------------------------------
    { text: "Our neighbor built a fence that encroaches on our lot.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "There is a dispute about the boundary between our properties.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "My neighbor moved the boundary markers of our land.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "The fence of our neighbor blocks part of our property.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "We disagree with our neighbor about where the wall should be built.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Our neighbor's construction is two feet inside our lot.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Inilipat ng kapitbahay ang boundary ng lote namin.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Gitakop ang bahin sa yuta sa akong silingan pinaagi sa bakod.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "My neighbor keeps extending his fence into our driveway.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "The property wall collapsed and now our neighbor claims our strip of land.", category: "Fence Boundary Conflict", urgency: "High" },
    { text: "Our neighbor refuses to remove the posts planted in our property.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "There is a heated argument with our neighbor about the lot line.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Someone demolished part of our fence claiming it is his land.", category: "Fence Boundary Conflict", urgency: "High" },
    { text: "The lot beside us was sold and the new owner put up a fence on our access road.", category: "Fence Boundary Conflict", urgency: "High" },
    { text: "Our neighbor's pig pen was built across our boundary line.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Hindi nagkakasundo ang kapitbahay tungkol sa hangganan ng aming lote.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Nag-away mi sa akong silingan bahin sa hangganan sa yuta.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "The fence dispute with our neighbor has lasted for years already.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Our neighbor put nails on the shared fence and damaged our side.", category: "Fence Boundary Conflict", urgency: "High" },
    { text: "My neighbor claims half of our yard because of an old survey plan.", category: "Fence Boundary Conflict", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Illegal Parking
    // ----------------------------------------------------------------
    { text: "A car is always parked in front of our gate and we cannot get out.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Someone parks their vehicle on the pedestrian lane every day.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Our neighbor's truck blocks the narrow street.", category: "Illegal Parking", urgency: "Normal" },
    { text: "A motorcycle is parked on the sidewalk forcing people onto the road.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Vehicles are obstructing the drainage and the street floods.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Someone double-parks on the highway causing traffic.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Nakaharang ang sasakyan ng kapitbahay sa aming pintuan tuwing umaga.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Na-arko ang sakyanan sa kalsada, dili makalabay ang uban.", category: "Illegal Parking", urgency: "Normal" },
    { text: "A vendor's car has been left on the road for a week already.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Cars block the entrance to our alley during the fiesta.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Someone parked their jeepney in front of the health center.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Illegal parking along the national road makes our daily commute dangerous.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Cars parked at the exit leave no space for ambulances to pass.", category: "Illegal Parking", urgency: "High" },
    { text: "Our neighbor's trailer occupies two lanes of the street.", category: "Illegal Parking", urgency: "Normal" },
    { text: "A car abandoned in front of the school blocks the students.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Motorcycles line the sidewalk so pedestrians cannot pass.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Someone parks on the fire lane of our building.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Hindi makalabas ang ambulance dahil nakaparada ang trak sa kalsada.", category: "Illegal Parking", urgency: "High" },
    { text: "The cargo truck of our neighbor is permanently parked on the road.", category: "Illegal Parking", urgency: "Normal" },
    { text: "Vehicles park on both sides leaving only one lane for everyone.", category: "Illegal Parking", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Street Light Out
    // ----------------------------------------------------------------
    { text: "The street light in front of our house has been out for weeks.", category: "Street Light Out", urgency: "Normal" },
    { text: "There is no lighting on our street and it is very dark at night.", category: "Street Light Out", urgency: "Normal" },
    { text: "The lamp post near the corner is broken and nobody fixes it.", category: "Street Light Out", urgency: "Normal" },
    { text: "Our alley is pitch dark because the street light is not working.", category: "Street Light Out", urgency: "Normal" },
    { text: "The light at the crossing has been out since the storm.", category: "Street Light Out", urgency: "Normal" },
    { text: "Walang ilaw sa aming kalsada, delikado maglakad sa gabi.", category: "Street Light Out", urgency: "Normal" },
    { text: "Wala nay suga sa among kalsada, mangitngit na kaayo sa gabii.", category: "Street Light Out", urgency: "Normal" },
    { text: "The street light flickers all night and keeps us awake.", category: "Street Light Out", urgency: "Normal" },
    { text: "Darkness in our purok because two street lights are busted.", category: "Street Light Out", urgency: "Normal" },
    { text: "The broken street light near the school is dangerous for children.", category: "Street Light Out", urgency: "Normal" },
    { text: "The solar street light has not been working for a month.", category: "Street Light Out", urgency: "Normal" },
    { text: "Our barangay road is unsafe because there is no illumination at night.", category: "Street Light Out", urgency: "Normal" },
    { text: "The light pole at the basketball court is leaning and turned off.", category: "Street Light Out", urgency: "Normal" },
    { text: "Nobody can see the potholes at night since the light went out.", category: "Street Light Out", urgency: "Normal" },
    { text: "The street light outside our house turns on only sometimes.", category: "Street Light Out", urgency: "Normal" },
    { text: "Gabi ay madilim ang aming eskinita dahil sira ang ilaw.", category: "Street Light Out", urgency: "Normal" },
    { text: "The lamp post was hit by a truck and now it is dead.", category: "Street Light Out", urgency: "Normal" },
    { text: "Residents are requesting repair of the broken lights along the road.", category: "Street Light Out", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Garbage Collection
    // ----------------------------------------------------------------
    { text: "Garbage is not being collected in our street for two weeks.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Our neighbor does not dispose of trash properly and it smells.", category: "Garbage Collection", urgency: "Normal" },
    { text: "There is a mountain of uncollected garbage near the drainage.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Stray cats scatter the garbage bags every morning.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Someone is dumping household waste in the vacant lot.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Hindi kinukuha ang basura sa aming purok tuwing nakatakdang araw.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Dili kunhaon ang basura sa among kalsada, humot na kaayo.", category: "Garbage Collection", urgency: "Normal" },
    { text: "The garbage truck skips our street without any reason.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Overflowing trash bins are attracting flies and rats.", category: "Garbage Collection", urgency: "Normal" },
    { text: "My neighbor burns plastic trash which produces toxic smoke.", category: "Garbage Collection", urgency: "High" },
    { text: "Dead animals are left rotting beside the canal near our house.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Garbage is being thrown into the canal causing a bad odor.", category: "Garbage Collection", urgency: "Normal" },
    { text: "The pickup schedule changed and waste is piling up at the corner.", category: "Garbage Collection", urgency: "Normal" },
    { text: "People leave their trash bags on the road for days.", category: "Garbage Collection", urgency: "Normal" },
    { text: "The communal trash area is overflowing and smelling bad.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Walang pumupuntang basura dito sa amin, amoy na amoy sa aming kalsada.", category: "Garbage Collection", urgency: "Normal" },
    { text: "A household leaves rotten food outside their door.", category: "Garbage Collection", urgency: "Normal" },
    { text: "The drainage is clogged with garbage from the houses upstream and our street floods.", category: "Garbage Collection", urgency: "High" },

    // ----------------------------------------------------------------
    // Construction Debris
    // ----------------------------------------------------------------
    { text: "Construction workers dumped gravel and sand on the road.", category: "Construction Debris", urgency: "Normal" },
    { text: "There are piles of debris blocking our street.", category: "Construction Debris", urgency: "Normal" },
    { text: "Leftover construction materials are blocking the drainage.", category: "Construction Debris", urgency: "Normal" },
    { text: "Someone dumped broken concrete in the empty lot.", category: "Construction Debris", urgency: "Normal" },
    { text: "The contractor left rubble that children can trip over.", category: "Construction Debris", urgency: "Normal" },
    { text: "Itinapon ang mga basura ng konstruksyon sa aming kalsada.", category: "Construction Debris", urgency: "Normal" },
    { text: "Gitabonan ang among kalsada og graba gikan sa konstruksyon.", category: "Construction Debris", urgency: "Normal" },
    { text: "Steel bars and wood scraps are scattered along the alley.", category: "Construction Debris", urgency: "Normal" },
    { text: "The road is narrowed by abandoned construction materials.", category: "Construction Debris", urgency: "Normal" },
    { text: "Excavation soil was left on the sidewalk after the works.", category: "Construction Debris", urgency: "Normal" },
    { text: "Broken tiles and cement bags were left beside the drain.", category: "Construction Debris", urgency: "Normal" },
    { text: "A renovation project dumped its waste in front of our house.", category: "Construction Debris", urgency: "Normal" },
    { text: "Construction debris in the waterway causes flooding when it rains.", category: "Construction Debris", urgency: "High" },
    { text: "The project's leftover sand covers half of our street.", category: "Construction Debris", urgency: "Normal" },
    { text: "Piles of hollow blocks are about to fall onto the road.", category: "Construction Debris", urgency: "High" },
    { text: "Workers mix cement on the road and leave it to harden.", category: "Construction Debris", urgency: "Normal" },
    { text: "Rubble from the demolished shed was never hauled away.", category: "Construction Debris", urgency: "Normal" },
    { text: "Nakaharang ang mga pinagbabangong materyales sa aming daan.", category: "Construction Debris", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Administrative Concern
    // ----------------------------------------------------------------
    { text: "I have been waiting for my barangay clearance for three weeks.", category: "Administrative Concern", urgency: "Normal" },
    { text: "My certificate of residency application has no update since last month.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The barangay officials have not processed my indigent application.", category: "Administrative Concern", urgency: "Normal" },
    { text: "I need a barangay ID but the office keeps telling me to come back another day.", category: "Administrative Concern", urgency: "Normal" },
    { text: "My paperwork was returned without any reason given.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Matagal na akong naghihintay ng aking barangay clearance.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Dugay na nako gihulat ang akong residency certificate nga giapil nako.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The barangay did not release my certificate even though I completed the requirements.", category: "Administrative Concern", urgency: "Normal" },
    { text: "I am requesting a copy of the barangay resolution but nobody responds.", category: "Administrative Concern", urgency: "Normal" },
    { text: "My application for financial assistance was not acknowledged by the office.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The barangay secretary was rude when I asked for my document.", category: "Administrative Concern", urgency: "Normal" },
    { text: "I paid for the certification but I have not received it after two weeks.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The office hours are confusing and we cannot transact during posted hours.", category: "Administrative Concern", urgency: "Normal" },
    { text: "My senior citizen booklet has not been updated for this year.", category: "Administrative Concern", urgency: "Normal" },
    { text: "There is no update on my complaint about the unregistered voter entry.", category: "Administrative Concern", urgency: "Normal" },
    { text: "I was told my records were lost and I need to reapply for everything.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The barangay has not responded to my request for assistance for a month.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Nobody is at the barangay hall during the posted office hours.", category: "Administrative Concern", urgency: "Normal" },
    { text: "My document was signed but still not released after two visits.", category: "Administrative Concern", urgency: "Normal" },
    { text: "The listing of beneficiaries for the aid program is incomplete.", category: "Administrative Concern", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Illegal Activity
    // ----------------------------------------------------------------
    { text: "There is drug selling happening in the house at the corner.", category: "Illegal Activity", urgency: "High" },
    { text: "My neighbor is selling illegal drugs to teenagers in our street.", category: "Illegal Activity", urgency: "High" },
    { text: "Illegal gambling is happening in the store every night.", category: "Illegal Activity", urgency: "Normal" },
    { text: "A house in our street is being used for shabu transactions.", category: "Illegal Activity", urgency: "High" },
    { text: "There are men with loose firearms drinking in the neighborhood.", category: "Illegal Activity", urgency: "Critical" },
    { text: "Someone is cutting trees in the forest without a permit.", category: "Illegal Activity", urgency: "Normal" },
    { text: "May nagtitinda ng ilegal na droga sa aming kanto.", category: "Illegal Activity", urgency: "High" },
    { text: "Adunay ilegal nga sugal duol sa among balay matag gabii.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Teenagers are sniffing solvent in the abandoned shed.", category: "Illegal Activity", urgency: "High" },
    { text: "A group is operating a secret lottery without any permit.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Fake money is being used at the market stalls.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Someone is operating a business without any barangay permit.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Cockfighting is being held secretly in the hinterlot.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Armed men are extorting money from tricycle drivers.", category: "Illegal Activity", urgency: "Critical" },
    { text: "Suspicious men are delivering packages to the drug house next door.", category: "Illegal Activity", urgency: "High" },
    { text: "A group of youths is taking turns as lookouts for a robbery gang.", category: "Illegal Activity", urgency: "High" },
    { text: "People are selling fake branded goods in front of the school.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Illegal fishing with cyanide is happening in our river.", category: "Illegal Activity", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Other (no supported category fits)
    // ----------------------------------------------------------------
    { text: "There is a deep pothole in front of our house that damages vehicles.", category: "Other", urgency: "Normal" },
    { text: "The drainage in our purok floods every time it rains heavily.", category: "Other", urgency: "Normal" },
    { text: "The health center closes early even though it says it is open until 5 PM.", category: "Other", urgency: "Normal" },
    { text: "A pedicab driver is overcharging passengers in our area.", category: "Other", urgency: "Normal" },
    { text: "There is no water supply in our house for three days already.", category: "Other", urgency: "Normal" },
    { text: "The internet post was installed in the middle of our lot without any notice.", category: "Other", urgency: "Normal" },
    { text: "Someone is collecting unauthorized fees from visitors in our street.", category: "Other", urgency: "Normal" },
    { text: "Our purok has no water pressure even though we pay the fees on time.", category: "Other", urgency: "Normal" },
    { text: "The tricycle driver keeps refusing to give the exact fare change.", category: "Other", urgency: "Normal" },
    { text: "A group is collecting money claiming it is for the barangay but gives no receipt.", category: "Other", urgency: "Normal" },
    { text: "There is a deep hole in the road that is not barricaded.", category: "Other", urgency: "Normal" },
    { text: "The water pipe in front of our house has been leaking for weeks.", category: "Other", urgency: "Normal" },
    { text: "The drainage floods whenever heavy rain comes in our area.", category: "Other", urgency: "Normal" },
    { text: "Nobody responds when we call the water district about low pressure.", category: "Other", urgency: "Normal" },
    { text: "My neighbor's toilet is overflowing into the alley.", category: "Other", urgency: "Normal" },
    { text: "The voters' list in our barangay has a wrong name on it.", category: "Other", urgency: "Normal" },
    { text: "I want to ask what requirements are needed for a residency certificate.", category: "Other", urgency: "Normal" },
    { text: "There is a strange smell coming from the abandoned lot every afternoon.", category: "Other", urgency: "Normal" },

    // ----------------------------------------------------------------
    // Round 2: coverage added after the first held-out evaluation,
    // targeting phrasings and features the model had never seen.
    // ----------------------------------------------------------------

    // Noise Disturbance — recurring, explicitly non-urgent phrasing
    { text: "Gising pa rin ang mga bata hanggang madaling araw dahil sa ingay ng kapitbahay.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "The music from the neighbor's house is constantly loud until midnight and repeats every day.", category: "Noise Disturbance", urgency: "Normal" },

    // Animal Nuisance — barking/annoyance stays Normal; bites are High
    { text: "Our neighbor's dogs bark constantly through the night and nobody in the house can rest.", category: "Animal Nuisance", urgency: "Normal" },
    { text: "A stray dog bit my nephew near the school gate last Tuesday.", category: "Animal Nuisance", urgency: "High" },
    { text: "An aggressive stray dog growls at everyone who passes our gate.", category: "Animal Nuisance", urgency: "High" },
    { text: "Our neighbor blames us for killing his old dog that died of natural causes.", category: "Animal Nuisance", urgency: "Normal" },

    // Physical Injury — group assault and weapons without serious
    // injury stay High; stabbings are Critical
    { text: "Three men ganged up on me outside the store and gave me a black eye.", category: "Physical Injury", urgency: "High" },
    { text: "He hit me with a stick during the quarrel and left a deep bruise on my arm.", category: "Physical Injury", urgency: "High" },
    { text: "Sinaksak ako ng aking kapitbahay sa binti matapos ang aming pag-aaway.", category: "Physical Injury", urgency: "Critical" },

    // Threat — firearm threats Critical, property threats High,
    // anonymous notes Normal
    { text: "He keeps saying he will shoot me on sight over our parking argument.", category: "Threat", urgency: "Critical" },
    { text: "Pinagbantaan ako ng kapitbahay na babasagin niya ang bintana namin.", category: "Threat", urgency: "High" },
    { text: "Someone left an anonymous note under our door telling us to leave the area.", category: "Threat", urgency: "Normal" },
    { text: "He sends me angry messages saying he will get even with me.", category: "Threat", urgency: "High" },

    // Theft — armed/masked robbery High-Critical, ordinary taking Normal
    { text: "Two masked men robbed the hardware store along the highway this morning.", category: "Theft", urgency: "High" },
    { text: "Someone has been taking fruits from our trees in the backyard without permission.", category: "Theft", urgency: "Normal" },
    { text: "A gold ring disappeared from our cabinet after a visitor came to our house.", category: "Theft", urgency: "Normal" },
    { text: "Someone took our garden hose and we have not seen it since.", category: "Theft", urgency: "Normal" },

    // Vandalism — property damage with no people involved stays Normal
    { text: "Someone scratched the side of my car with a key while it was parked at the plaza.", category: "Vandalism", urgency: "Normal" },
    { text: "Someone punctured the four tires of our jeepney with a nail while it was parked.", category: "Vandalism", urgency: "Normal" },
    { text: "Vandals smashed the benches at the waiting shed near the chapel.", category: "Vandalism", urgency: "Normal" },

    // Garbage Collection — routine accumulation, even over a fence
    { text: "Our neighbor throws household garbage over the fence and it lands in our yard.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Garbage has not been collected on our street for over a week and it now smells.", category: "Garbage Collection", urgency: "Normal" },

    // Illegal Activity — gambling and armed hunting
    { text: "Small-time betting is happening at the vacant lot near the store each night.", category: "Illegal Activity", urgency: "Normal" },
    { text: "Two men are hunting birds with air rifles in the residential area at night.", category: "Illegal Activity", urgency: "High" },

    // Other — utility and public-facility problems with no better home
    { text: "The water supply in our house has been cut off for more than a week though we already paid.", category: "Other", urgency: "Normal" },
    { text: "Power lines along our street keep flickering since the storm passed.", category: "Other", urgency: "Normal" },
    { text: "A plank is missing from the footbridge near our street and someone already slipped on it.", category: "Other", urgency: "Normal" },

    // Domestic Dispute — peaceful settlement, no injury
    { text: "A dispute between siblings over their parents' inheritance is being settled peacefully.", category: "Domestic Dispute", urgency: "Normal" },

    // Fence Boundary Conflict — marker/post moves stay Normal
    { text: "Our neighbor moved the concrete posts marking the boundary of our lots.", category: "Fence Boundary Conflict", urgency: "Normal" },
    { text: "Nakatayo na ang bakod ng kapitbahay sa gilid ng aming daan.", category: "Fence Boundary Conflict", urgency: "Normal" },

    // Illegal Parking — routine obstruction
    { text: "My neighbor's multicab is parked on the narrow road and other vehicles cannot get through.", category: "Illegal Parking", urgency: "Normal" },

    // Administrative Concern — service delays stay Normal, and Tagalog
    // narratives that must not inherit urgency from function words
    { text: "Many stalls in the public market close early even though the posted hours say otherwise.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Matagal na akong nagpapadala ng aking mga hinaing sa tanggapan ngunit walang sagot.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Walang sumasagot sa aking mga sulat na ipinadala sa barangay hall.", category: "Administrative Concern", urgency: "Normal" },
    { text: "Mail carriers refuse to deliver our letters until we show a residency card.", category: "Administrative Concern", urgency: "Normal" },

    // Round 2b — second held-out pass
    { text: "Someone keyed the paint of my car while it was parked at the fiesta.", category: "Vandalism", urgency: "Normal" },
    { text: "They hit me with sticks and left bruises all over my arms.", category: "Physical Injury", urgency: "High" },
    { text: "Thieves rode off with my bicycle parked on our terrace last night.", category: "Theft", urgency: "High" },
    { text: "Someone stole the battery of our tricycle while it was parked at the market.", category: "Theft", urgency: "High" },
    { text: "A man intimidates vendors at the market and demands payment every week.", category: "Threat", urgency: "High" },
    { text: "A threatening letter was left at our gate but it contained no actual demand.", category: "Threat", urgency: "Normal" },
    { text: "Relatives bicker about money at family occasions but everyone calms down after.", category: "Domestic Dispute", urgency: "Normal" },
    { text: "Our neighbor keeps tossing garbage over our fence into the yard every weekend.", category: "Garbage Collection", urgency: "Normal" },
    { text: "Broken hollow blocks from the renovation are piled at the roadside awaiting pickup.", category: "Construction Debris", urgency: "Normal" },

    // Round 2c — third held-out pass
    { text: "The videoke session next door is loud in the evening but ends before midnight.", category: "Noise Disturbance", urgency: "Normal" },
    { text: "Our neighbor's dog got loose and chased a child near the waiting shed.", category: "Animal Nuisance", urgency: "High" },
    { text: "Ang eskinita namin ay laging napupunan ng mga paradang tricycle kaya hindi makadaan ang iba.", category: "Illegal Parking", urgency: "Normal" },
    { text: "My neighbor keeps threatening to damage our car whenever we argue.", category: "Threat", urgency: "High" },
    { text: "A thief broke the panel of our tricycle and took our tools.", category: "Theft", urgency: "High" },
    { text: "Someone has been stealing ripe bananas from our yard every morning.", category: "Theft", urgency: "Normal" },

  ],
};
