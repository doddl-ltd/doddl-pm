#!/usr/bin/env python3
"""
doddl Copy Update Script
Applies all reviewed copy from the copy review Excel to the prototype HTML files.
Run from the repo root: python3 update_copy.py
"""

import os, re

FILES = {
    'homepage':   'public/prototypes/homepage/desktop.html',
    'sbs':        'public/prototypes/journey/desktop.html',
    'sen':        'public/prototypes/journey/sen-desktop.html',
    'bundle':     'public/prototypes/bundle-box/desktop.html',
    'category':   'public/prototypes/category/desktop.html',
}

# Load all files
pages = {}
for key, path in FILES.items():
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            pages[key] = f.read()
        print(f'  loaded: {path}')
    else:
        print(f'  MISSING: {path}')
        pages[key] = None

changed = {k: 0 for k in FILES}

def rep(key, old, new):
    """Replace old with new in the given page. Report if not found."""
    global pages, changed
    if pages[key] is None:
        return
    new_clean = new.strip()
    if not new_clean or new_clean in ('NOT NEEDED (PERFECT GIFT COVERS)', 'Not needed', 'remove this stage', ''):
        return  # skip blanks and instructions
    if old.strip() == new_clean:
        return  # no change needed
    if old in pages[key]:
        pages[key] = pages[key].replace(old, new_clean, 1)
        changed[key] += 1
    else:
        print(f'  [NOT FOUND] {key}: "{old[:60]}..."')

# ═══════════════════════════════════════════════════════════
# HOMEPAGE — public/prototypes/homepage/desktop.html
# ═══════════════════════════════════════════════════════════
print('\n── Homepage ──')

# Hero
rep('homepage', 'Developmental dining tools', 'Development tableware trusted by 1 million+ parents')
rep('homepage', 'The right tool.', 'The right tool at the right age changes everything')
rep('homepage', 'At every stage.', '')
rep('homepage',
    'Cutlery designed to grow with your child — from first tastes at 6 months to confident independence at 5 years. Trusted by 25,000+ parents and recommended by paediatric OTs.',
    'Tableware designed to enhance development and make mealtimes easier — from first tastes at 6 months to confident independence at 5 years. Trusted by 1 million+ parents and recommended by paediatric OTs.')

# Trust bar
rep('homepage', '5 stages', '4 stages')
rep('homepage', '0 months – 5 years', '0 months – 5+ years')
rep('homepage', '500+', '1,000,000')
rep('homepage', 'Nursery partners', 'parents trust doddl')
rep('homepage', 'OT recommended', 'OT - NHS Paediatric Occupational Therapist')
rep('homepage', 'Paediatric occupational therapists', '')

# Stage tabs intro
rep('homepage',
    'Every child develops differently, but the stages of independent eating are universal. doddl makes a product matched precisely to each one — so your child always has the tool that helps them succeed, not struggle.',
    "Every child finds their own pace — but most move through four key stages between 6 months and 5 years, each shaped by what their little hands can do. doddl products are designed around exactly those stages, so the products your child is using always works with their developing grip, not against it.")
rep('homepage',
    'Click a stage below to see milestones, the right products, and what to look for next.',
    "Click a stage below to check the signs to look for, the right products, and when to know it's time to move on")

# Stage 0
rep('homepage', 'Your journey starts now', 'Your journey starts soon')
rep('homepage',
    "Before the first spoon comes out, your baby is already developing the skills they'll need. We'll tell you exactly when they're ready — and what to buy.",
    "At doddl we've spent over 10 years studying how children's fine motor-skills develop so when you think your baby is ready to start eating, explore Stage 1. In the meantime, you can help your baby get ready to self-feed right now.")
rep('homepage', 'Head and neck control developing', 'Offer different objects to grasp')
rep('homepage', 'Watching you eat with interest', 'Let them explore touching different textures')
rep('homepage', 'Reaching and grasping objects', 'Allow your baby to experience cooking smells')
rep('homepage', 'Sitting upright with support beginning', 'Let your baby watch you eat')
rep('homepage', 'Weaning starts at 6 months', 'Weaning is recommended from 6 months')
rep('homepage',
    "We'll remind you at the right moment with a personalised guide to your child's first stage.",
    "Not quite ready for weaning yet? Sign up for our free development series — built around exactly where your baby is right now.")
rep('homepage', 'Send me a reminder →', 'Sign me up')
rep('homepage',
    'Understanding the developmental stages before weaning begins makes the whole journey more confident and less stressful.',
    'Grasping skills are vital for future participation in every day tasks such as self-feeding, self-care, writing, colouring and manipulating classroom tools')
rep('homepage', '— Paediatric OT, doddl partner', 'Christine Pollack — Paediatric OT')
rep('homepage',
    "Your baby will be ready for their first spoon sooner than you think. Here's a preview of what Stage 1 looks like.",
    'Think your baby is ready for baby-led weaning cutlery? Explore Stage 1 products')

# Stage 1
rep('homepage', 'First foods, first wins', 'Explore, taste, try')
rep('homepage',
    'The spoon goes in — and usually everywhere else. doddl is designed for tiny hands that are just figuring this out.',
    "This stage is all about exploring. Embrace the food on your baby's face and the floor; doddl stage 1 products are designed for tiny hands that are just discovering what mealtimes are all about. You'll know when to introduce cutlery when your baby is showing these signs:")
rep('homepage', 'Sitting in a high chair with support', 'Sitting in a highchair with gentle support')
rep('homepage', 'Reaching and grasping objects reliably', 'Reaching and grasping objects consistently')
rep('homepage', 'Bringing hand to mouth confidently', 'Using their hands to explore foods')
rep('homepage', 'Showing real interest in what you eat', 'Growing appetite')
rep('homepage',
    "doddl's ergonomic design means babies succeed from the very first try. That early confidence matters enormously for development.",
    "As a pediatric feeding therapist, I frequently have parents ask me for recommendations on feeding tools like forks and spoons. The handles are also ergonomically designed to encourage a proper grip. These are perfect for helping to develop independent feeding skills.")
rep('homepage', '— Katie Rawlings, Paediatric OT', 'Colleen Sarrazin, Paediatric Feeding Therapist and Speech-Language Pathologist')
rep('homepage',
    "When your child starts grabbing the spoon and trying to steer it themselves, they're ready for Stage 2 — Building Control (12–18m).",
    "When your baby has developed some hand-eye co-ordination, they're able to consistently move food from the bowl to their mouth and are eating more substantial meals, you'll need the best cutlery for toddlers. Time for stage 2.")

# Stage 2
rep('homepage', 'Stage 2 · 12–18 months', 'Stage 2 · 12–24 months')
rep('homepage', 'Grip it, own it', 'Watch ME Go!')
rep('homepage',
    'The pincer grip arrives and suddenly your toddler wants to do everything themselves. The right tools make that possible — and a lot less messy.',
    "Your toddler's desire for independence is growing and their hands are making their biggest development leap. The right tools will make that transition happen faster — and with a lot less mess and stress. doddl stage 2 products are designed for when your toddler is showing these signs:")
rep('homepage', 'Pincer grip developing fast', 'Eating more substantial meals')
rep('homepage', 'Deliberately scooping food', 'Desire to scoop effectively')
rep('homepage', 'Self-feeding for most of the meal', 'Eager to stab food')
rep('homepage', 'Frustrated if you try to help!', 'Getting frustrated if you try to help')
rep('homepage',
    'The 12–18 month period is critical for fine motor development. Tools matched to grip development make a measurable difference.',
    "I love the unique design of doddl cutlery. The short, moulded handles fit perfectly in little hands and have a soft middle for a comfortable grip. I also love how they support motor skill development like dexterity and coordination, making self-feeding easier.")
rep('homepage', '— Dr. Sarah Mills, Child Development Specialist', 'Penelope Henderson - Registered Children\'s Nutritionist &amp; SOS Trained Feeding Therapist')
rep('homepage',
    "When your toddler is self-feeding most meals and wants to eat alongside the family, Stage 3 is calling.",
    "When your toddler is successfully self-feeding with a spoon and fork, is less inclined to throw their plate on the floor and would love to chop up their own food - they're ready for stage 3")

# Stage 3
rep('homepage', 'Stage 3 · 18 months – 3 years', 'Stage 3 · 2–5+ years')
rep('homepage', 'Self-feeding mastery', 'Independence: unlocked')
rep('homepage',
    'Not baby tools anymore. Real cutlery that lasts the whole toddler stage — durable, dishwasher safe, and nursery ready.',
    "You'll know that your toddler's desire for independence is powerful. The right tools will turn that determination into genuine skill. doddl stage 3 products develop your toddler's fine motor-skills at mealtimes and beyond. When your toddler shows these signs, they're ready for stage 3.")
rep('homepage', 'Self-feeding confidently at most meals', 'Using a fork and spoon successfully')
rep('homepage', 'Using utensils correctly most of the time', 'Growing confidence at mealtimes')
rep('homepage', 'Eating alongside the rest of the family', 'Interest in chopping their own food')
rep('homepage', 'Ready for nursery mealtimes independently', 'Eager to get involved in the kitchen')
rep('homepage',
    'We switched all our nursery mealtimes to doddl two years ago. The difference in self-feeding independence is remarkable.',
    'As practitioners we have seen amazing results in independence at lunchtime and snack time, as well as with fine motor skill development.')
rep('homepage', '— Nursery Manager, London', 'The Coigne Nursery, UK')
rep('homepage',
    "When your child starts wanting to cut food themselves or watches you use a knife with real intent, Stage 4 is next.",
    "Once your child is confident with doddl stage 3 products they will be ready to transition to adult tableware - but there's no rush. The ergonomic design supports the correct grip, so your child can easily move on whenever they are ready.")

# ═══════════════════════════════════════════════════════════
# SHOP BY STAGE — public/prototypes/journey/desktop.html
# ═══════════════════════════════════════════════════════════
print('\n── Shop by Stage ──')

sbs_replacements = [
    # Stage 0
    ('Your journey starts now', 'Your journey starts soon'),
    ("Before the first spoon comes out, your baby is already developing the skills they'll need. We'll tell you exactly when they're ready — and what to buy.",
     "At doddl we've spent over 10 years studying how children's fine motor-skills develop so when you think your baby is ready to start eating, explore Stage 1. In the meantime, you can help your baby get ready to self-feed right now."),
    ('Head and neck control developing', 'Offer different objects to grasp'),
    ('Watching you eat with interest', 'Let them explore touching different textures'),
    ('Reaching and grasping objects', 'Allow your baby to experience cooking smells'),
    ('Sitting upright with support beginning', 'Let your baby watch you eat'),
    ('Weaning starts at 6 months', 'Weaning is recommended from 6 months'),
    ("We'll remind you at the right moment with a personalised guide to your child's first stage.",
     "Not quite ready for weaning yet? Sign up for our free development series — built around exactly where your baby is right now."),
    ('Send me a reminder →', 'Sign me up'),
    ('Understanding the developmental stages before weaning begins makes the whole journey more confident and less stressful.',
     'Grasping skills are vital for future participation in every day tasks such as self-feeding, self-care, writing, colouring and manipulating classroom tools'),
    ('— Paediatric OT, doddl partner', 'Christine Pollack — Paediatric OT'),
    ("Your baby will be ready for their first spoon sooner than you think. Here's a preview of what Stage 1 looks like.",
     'Think your baby is ready for baby-led weaning cutlery? Explore Stage 1 products'),
    # Stage 1
    ('First foods, first wins', 'Explore, taste, try'),
    ('The spoon goes in — and usually everywhere else. doddl is designed for tiny hands that are just figuring this out.',
     "This stage is all about exploring. Embrace the food on your baby's face and the floor; doddl stage 1 products are designed for tiny hands that are just discovering what mealtimes are all about. You'll know when to introduce cutlery when your baby is showing these signs:"),
    ('Sitting in a high chair with support', 'Sitting in a highchair with gentle support'),
    ('Reaching and grasping objects reliably', 'Reaching and grasping objects consistently'),
    ('Bringing hand to mouth confidently', 'Using their hands to explore foods'),
    ('Showing real interest in what you eat', 'Growing appetite'),
    ("doddl's ergonomic design means babies succeed from the very first try. That early confidence matters enormously for development.",
     "As a pediatric feeding therapist, I frequently have parents ask me for recommendations on feeding tools like forks and spoons. The handles are also ergonomically designed to encourage a proper grip. These are perfect for helping to develop independent feeding skills."),
    ('— Katie Rawlings, Paediatric OT', 'Colleen Sarrazin, Paediatric Feeding Therapist and Speech-Language Pathologist'),
    ("When your child starts grabbing the spoon and trying to steer it themselves, they're ready for Stage 2 — Building Control (12–18m).",
     "When your baby has developed some hand-eye co-ordination, they're able to consistently move food from the bowl to their mouth and are eating more substantial meals, you'll need the best cutlery for toddlers. Time for stage 2."),
    # Stage 2
    ('Stage 2 · 12–18 months', 'Stage 2 · 12–24 months'),
    ('BUILDING CONTROL', 'BUILDING CONTROL'),
    ('Grip it, own it', 'Watch ME Go!'),
    ('The pincer grip arrives and suddenly your toddler wants to do everything themselves. The right tools make that possible — and a lot less messy.',
     "Your toddler's desire for independence is growing and their hands are making their biggest development leap. The right tools will make that transition happen faster — and with a lot less mess and stress. doddl stage 2 products are designed for when your toddler is showing these signs:"),
    ('Pincer grip developing fast', 'Eating more substantial meals'),
    ('Deliberately scooping food', 'Desire to scoop effectively'),
    ('Self-feeding for most of the meal', 'Eager to stab food'),
    ('Frustrated if you try to help!', 'Getting frustrated if you try to help'),
    ('The 12–18 month period is critical for fine motor development. Tools matched to grip development make a measurable difference.',
     "I love the unique design of doddl cutlery. The short, moulded handles fit perfectly in little hands and have a soft middle for a comfortable grip. I also love how they support motor skill development like dexterity and coordination, making self-feeding easier."),
    ('— Dr. Sarah Mills, Child Development Specialist', 'Penelope Henderson - Registered Children\'s Nutritionist &amp; SOS Trained Feeding Therapist'),
    ("When your toddler is self-feeding most meals and wants to eat alongside the family, Stage 3 is calling.",
     "When your toddler is successfully self-feeding with a spoon and fork, is less inclined to throw their plate on the floor and would love to chop up their own food - they're ready for stage 3"),
    # Stage 3
    ('Stage 3 · 18 months – 3 years', 'Stage 3 · 2–5+ years'),
    ('Self-feeding mastery', 'Independence: unlocked'),
    ('Not baby tools anymore. Real cutlery that lasts the whole toddler stage — durable, dishwasher safe, and nursery ready.',
     "You'll know that your toddler's desire for independence is powerful. The right tools will turn that determination into genuine skill. doddl stage 3 products develop your toddler's fine motor-skills at mealtimes and beyond. When your toddler shows these signs, they're ready for stage 3."),
    ('Self-feeding confidently at most meals', 'Using a fork and spoon successfully'),
    ('Using utensils correctly most of the time', 'Growing confidence at mealtimes'),
    ('Eating alongside the rest of the family', 'Interest in chopping their own food'),
    ('Ready for nursery mealtimes independently', 'Eager to get involved in the kitchen'),
    ('We switched all our nursery mealtimes to doddl two years ago. The difference in self-feeding independence is remarkable.',
     'As practitioners we have seen amazing results in independence at lunchtime and snack time, as well as with fine motor skill development.'),
    ('— Nursery Manager, London', 'The Coigne Nursery, UK'),
    ("When your child starts wanting to cut food themselves or watches you use a knife with real intent, Stage 4 is next.",
     "Once your child is confident with doddl stage 3 products they will be ready to transition to adult tableware - but there's no rush. The ergonomic design supports the correct grip, so your child can easily move on whenever they are ready."),
]
for old, new in sbs_replacements:
    rep('sbs', old, new)

# ═══════════════════════════════════════════════════════════
# SEN JOURNEY — public/prototypes/journey/sen-desktop.html
# ═══════════════════════════════════════════════════════════
print('\n── SEN Journey ──')

sen_replacements = [
    # Just Starting Out
    ('Your child is starting to show interest in mealtimes. They might not be able to hold a spoon yet, and that\'s completely fine. This is where we begin — together.',
     "You would love your child to start learning how to use cutlery. They might not be able to hold a spoon yet, and that's completely fine. This is where we begin — together. We would recommend 'just starting out' products if all the following applies to your child:"),
    ('Starting to watch you eat and showing curiosity', 'Your child has no experience of using cutlery'),
    ('Attempting to reach toward food or utensils', 'Your child has limited hand eye coordination'),
    ('Some hand-to-mouth movement, even if unsteady', 'Your child may need some support to sit at mealtimes'),
    ('Sitting with support during mealtimes', 'Your child has involuntary movements'),
    ('Every single one of these is worth celebrating. The interest is there — and that\'s everything. The rest follows.',
     "Stage one utensils are recommended if all of the above apply. The handle and utensil end is sized for children 6–12 months. If you are unsure on the sizing, we would suggest looking at the 'establishing their grip' stage or contact us directly for guidance hello@doddl.com"),
    ('Find the right tools →', 'Find the right products for your child'),
    ('We\'d tried everything. Archie has dyspraxia and mealtimes were a battle every single day. The first time he fed himself with doddl I actually cried. It took us longer than most — but we got there.',
     "I just wanted to drop you a line to thank you for your amazingly designed cutlery! My little boy is 26 months old and has Autism, and whilst he loves his food, he has never been able to use cutlery by himself before. In fact he often refused to eat from cutlery at all, even when fed. This morning, the first time he used his doddl spoon, Alex fed himself for the first time ever. I can't tell you how much it means to see our boy hitting a milestone like this, after trying to help with his independent feeding for so long. doddl is a life changer! Thank you so much - we've recommended you to all our friends at ASD tots groups and have bought 3 more sets to keep at grandparents and day care! Thank you, your design is improving the lives of kids like Alex and parents like me!"),
    ('Emma, mum to Archie — dyspraxia, \'Just starting out\' stage', 'Niki, Mum to Alex - Just Starting Out Stage'),
    ('For children with limited grip strength or motor coordination challenges, doddl\'s ergonomic handle design significantly reduces the effort required to self-feed. I recommend it to families in the earliest stages of intervention.',
     "As a pediatric occupational therapist and feeding specialist, I am always looking at new and innovative feeding products and came across the doddl utensil set. It's an incredible design! The handle is a perfect combination of chunky yet light and short which promotes a comfortable and functional grasp for his little hands."),
    ('— Sarah Jennings, Paediatric Occupational Therapist, NHS &amp; private practice', 'Vanessa Eisch - Occupational Therapist'),
    ('— Sarah Jennings, Paediatric Occupational Therapist, NHS & private practice', 'Vanessa Eisch - Occupational Therapist'),
    ('Lightweight, easy-grip tools designed for children who are just beginning to explore self-feeding. No frustration. Just the right amount of support.',
     "Lightweight, easy to grip tools designed for children who are beginning to explore tastes and textures. The rounded utensil ends are gentle in their mouths, and safe to use during the 'face-bumping' stage whilst hand-eye coordination is establishing."),
    ("When your child begins holding the spoon rather than just reaching for it, even briefly, even imperfectly — that's the sign they're moving into the next chapter. There's no rush. You'll know when you see it.",
     "When your child can hold the utensils, and move some food successfully to their mouth, you may wish to look at the next stage 'Establishing their grip'"),
    # Finding/Establishing their grip
    ('Finding their grip', 'Establishing their grip'),
    ("They're holding on — and that's huge", "They're gripping — and that's huge"),
    ('Your child is beginning to grip and guide. It might be inconsistent. It might take ten attempts to get a spoonful. That\'s not failure — that\'s exactly what progress looks like at this stage.',
     "Your child is beginning to grip and guide. It might be inconsistent. It might take ten attempts to get a spoonful in. That's not failure — that's exactly what progress looks like at this stage - a desire to keep practising and celebrate the small wins. We would recommend doddl in this stage if the following apply:"),
    ('Grasping the spoon or fork, even if loosely', 'Your child can move food to their mouth'),
    ('Attempting to guide food toward their mouth', 'Your child has some experience of handling cutlery'),
    ('More deliberate reaching than before', "Your child's appetite is growing"),
    ('Getting frustrated when they can\'t quite manage — a great sign of intent', 'Your child is showing signs of wanting to self feed'),
    ('The frustration means they want to do it themselves. That drive is everything. doddl is built to make those attempts successful more often.',
     'The frustration means they want to do it themselves. That drive is everything. doddl is built to make those attempts more successful, more often.'),
    ('Mia has hypermobility. Her grip just wasn\'t strong enough for normal cutlery — it would slip and she\'d get so upset. With doddl she can actually hold it. Our OT said it was the best thing we\'d tried.',
     "Ada has Down Syndrome and believe me when I say, I've tried every kind of cutlery set out there...until doddl came to our rescue! In just 4 days, you could see the progress she had made! This has been a complete game changer for us. Ada Grace is so much happier, and as a sceptical parent of most things (you'd be surprised at how many products really aren't made with SEN children in mind), I can honestly say doddl have certainly achieved this. I'm so pleased to finally find something on which has made such an incredible difference to our daily routine."),
    ('Rachel, mum to Mia — hypermobility, \'Finding their grip\' stage', 'Emma - mum to Ada Grace - Establishing Grip stage'),
    ('The short handle and weighted design means children with hypermobility or low muscle tone can grip without the wrist fatigue that standard cutlery causes. It changes the mealtime experience completely.',
     "I absolutely love doddl because they are ergonomically designed to foster independent feeding while building motor skills. Each utensil has grip zones strategically placed making it much easier to maintain control and manoeuvre the utensils."),
    ('— Dr. Priya Mehta, Paediatric OT, specialist in hypermobility and EDS', 'Christine Pollack - Paediatric Occupational Therapist'),
    ('Designed to make gripping easier and more successful — so the focus can stay on eating, not on managing the cutlery.',
     "The compact, rounded handles are shaped to make gripping feel natural and comfortable — not forced. The shorter length brings food closer to the mouth, so the focus stays on the meal, not the effort of using the cutlery."),
    ("When your child starts having more successful meals than difficult ones — even if it's two good days then a harder one — that's the shift toward building confidence.",
     "Once your child is regularly having successful mealtimes, and able to effectively scoop with the spoon and stab with the fork and no longer requires a suction bowl or plate, that's the sign they are ready to move onto 'building confidence'"),
    # Building Confidence
    ('Your child is self-feeding some of the time. There are still difficult meals — that\'s normal, even expected. The tools at this stage are about making the good days more consistent, not eliminating the hard ones.',
     "Learning to self-feed is coming on leaps and bounds. There may still be difficult mealtimes - that's normal, even expected. The tools at this stage are embracing their developing skills and making the good days more consistent, not eliminating the hard ones. Signs your child may be ready for 'building confidence':"),
    ('Self-feeding for part of the meal most days', 'Self-feeding for part of their meal most days'),
    ('Starting to show preferences — this food, that utensil', 'Able to use a spoon and/or a fork effectively'),
    ('Less frustration with the tools, more with the food itself (progress!)', 'Starting to show an interest in chopping their own food'),
    ('The hard days don\'t erase the good ones. Every meal they feed themselves — even one spoonful — is real progress. Write it down if it helps.',
     "The hard days don't erase the good ones. Every mouthful they feed themselves — even one spoonful — is real progress. It may be 1 step forward and 10 steps backward, but there is no hurry, your journey is unique, keep going."),
    ('We had good weeks and terrible weeks for a long time. But the terrible weeks got shorter. Our OT said to stop counting the bad meals and start counting the good spoonfuls. doddl made the good spoonfuls happen.',
     "Ada has Down Syndrome and believe me when I say, I've tried every kind of cutlery set out there...until doddl came to our rescue! In just 4 days, you could see the progress she had made! This has been a complete game changer for us. Ada Grace is so much happier, and as a sceptical parent of most things, I can honestly say doddl have certainly achieved this. I'm so pleased to finally find something which has made such an incredible difference to our daily routine."),
    ('James, dad to Oliver — cerebral palsy, \'Building confidence\' stage', 'Emma - mum to Ada Grace'),
    ('Consistency of the tool matters enormously at this stage. Children with motor challenges build muscle memory slowly — changing utensils disrupts that process. I advise families to stick with doddl and trust the repetition.',
     "doddl cutlery is fantastic for supporting young children with independent eating, grasping those tricky cutlery skills and allowing little ones to get stuck in exploring the wonderful world of food"),
    ('— Claire Thompson, Senior Paediatric OT, specialist in cerebral palsy and DCD', 'Lucy Upton - Specialist Paediatric Dietician'),
    ('At this stage consistency is everything. The same tool, every meal, lets your child build the muscle memory they need to get there.',
     'At this stage consistency is everything. The same tool, every meal, helps your child build muscle memory to help them get there.'),
    ("When your child sits down and just… gets on with it — without you needing to help, without the tools slipping — that's the moment. And it will come.",
     "When your child sits down and just…starts eating — without so much help, without the tools slipping, with much less frustration — that's the moment. And it will come."),
]
for old, new in sen_replacements:
    rep('sen', old, new)

# ═══════════════════════════════════════════════════════════
# BUNDLE BOX — public/prototypes/bundle-box/desktop.html
# ═══════════════════════════════════════════════════════════
print('\n── Bundle Box ──')

bundle_replacements = [
    # Hero
    ('Your child will outgrow', '5,000 mealtimes'),
    ('every tool you buy them.', '6 products. 3 development stages.'),
    ('We put all of them', 'We put them all'),
    ('in one box.', 'in one box'),
    ('Every parent figures it out the same way. The tiny spoon works brilliantly at six months. By twelve months it doesn\'t. You buy something new. At eighteen months that doesn\'t work either. By the time they\'re at the family table you\'ve bought and replaced half a dozen things — none of which talked to each other.',
     "Everything your baby needs from first bites to independent eating. doddl products are expertly engineered for each stage of your child's development. Why? Because the right tools at the right stage changes everything"),
    ('We designed six products — each engineered for the exact developmental stage it\'s needed — and put them together in one cool box. You open it once, reach in at the right moment, and everything is already there.',
     "We designed six products — each engineered for the exact developmental stage it's needed for — and put them together in one premium box. Reach in at the right moment to find everything you need to enhance your baby's development at every stage."),
    # Product Overview
    ('The doddl Bundle Box', 'The ultimate baby to toddler mealtime set'),
    ('Six products. Four stages. From first spoon to the family dinner table.', 'Six products. 3 stages. From first spoon to confident independent eater'),
    ('Bought separately these six products cost £109.94 — the bundle box is £80 with free delivery.',
     '3 meals a day, over 5,000 mealtimes, from 6 months to 5+ years. Helping advance your child\'s development, grow key skills and make mealtimes easier.'),
    ('30-day guarantee', 'Money back guarantee'),
    # Stats
    ('4 developmental stages covered', '3 developmental stages covered'),
    ('£29 saved vs buying individually', 'Trusted by over 1,000,000 parents'),
    ('5yr of use from one purchase', '5 years of value from one purchase'),
    # Inside the box
    ('Six products. Nothing missing. Every item is designed for a specific developmental stage. None of it is padding — each product has a moment when it\'s exactly right, and the stage guide below tells you when.',
     "Six products. 10 years of expertise. Each item is designed for a specific developmental stage. What your baby needs, at exactly the right time. The stage guide below tells you when."),
    ('Short handle, wide bowl. The ergonomic shape means tiny hands succeed on the very first try — no adapting to standard cutlery that was never made for them.',
     "Expertly designed compact handles mean your baby's tiny hands can hold this cutlery in their basic grasp, but the shape intuitively encourages the development of the more advanced pincer grip."),
    ('Keeps the baby cutlery clean and together. Clip it to the nursery bag from day one — mealtimes happen everywhere, not just at home.',
     'Keeps your baby cutlery hygienic and together. Clip it to the nursery bag from day one — mealtimes happen everywhere, not just at home and consistency is key.'),
    ('Suction base locks to the highchair tray — your child focuses on the spoon, not the bowl. Remove the base at Stage 2 when they\'re ready. One bowl, two stages.',
     "Oval shape and high back makes learning to scoop simple and food more easily accessible. Suction base locks to the highchair tray so your child can focus on the scooping, not the bowl. Suction rim is easy to remove and reattach helping smooth the transition between suction and non-slip. One bowl, two stages."),
    ('The upgrade cutlery — spoon, fork and knife. Real tools, not plastic. Dishwasher safe. Engineered for the grip strength of a toddler. Introduce alongside the baby cutlery and let them lead the switch.',
     "Toddler cutlery - doddl spoon and fork. Highly effective tools. Engineered to further advance grip strength and intuitively teach the correct finger placement needed for adult cutlery. Introduce around 11–12 months when your baby is eating more substantial meals and has developed some co-ordination."),
    ('Comes out of the box at Stage 2. Same 2-in-1 suction mechanic as the bowl — fixed while confidence builds, free when they no longer need it.',
     "Oval shape, higher back and lipped front supports learning and reduces mess. Splat focuses the eye to the middle of the plate. Comes out of the box at Stage 2 but has the same 2-in-1 suction mechanic as the bowl — fixed while confidence builds, free when they no longer need it."),
    ('Swaps in when the baby case is outgrown. Holds the full 3-piece set. Nursery, school, restaurants, grandparents — the same tools, everywhere.',
     "Swaps in when the toddler cutlery is in use. Holds the fork and spoon set and the knife fork and spoon set when your child moves on to stage 3. Nursery, school, restaurants, grandparents — the same tools, everywhere."),
    ('Everything lives in the cool box. It\'s the gift you wrap — and the thing that stays in the kitchen or nursery bag for years. Designed to be kept, not binned.',
     "Everything arrives in a premium box. It's the gift you wrap — with exceptional products that stay in the kitchen or nursery bag for years. Store your doddl in this box until the very moment you need them."),
    # Stage guide
    ('The box is designed to be opened in stages, not all at once. Each stage matches a real developmental moment in your child\'s life. Here\'s exactly what that looks like.',
     "These products are designed to be used in combination, in different stages. Each stage matches a real developmental moment in your child's life, with this complete set you'll be ready when your child is. Here's exactly what that looks like."),
    ('Stage 1 · 6–12 months — First foods', 'Stage 1 · 6–12 months — Try, taste, explore'),
    ('What\'s happening', "When they are ready"),
    ('Your baby is starting to wean. They\'re sitting with support, reaching deliberately, and bringing things to their mouth. This is one of the most exciting developmental windows — the first time they have agency over what goes in. The right tools make the difference between a chaotic mealtime and a successful one.',
     "Your baby is ready to start exploring foods at around 6 months. This is one of the most exciting developmental windows — when they start to have control over what goes in their mouth. The right tools make all the difference to development at this age."),
    ('Sitting upright with support in a highchair', 'Sitting in a highchair with gentle support'),
    ('Reaching deliberately for objects and food', 'Reaching and grasping objects consistently'),
    ('The short handle works with a developing grip, not against it. Standard cutlery is too long — this is built for the reach they have right now.',
     "Ergonomic handles are easy to grasp and designed to develop the grip from palmer grasp to pincer grip. Comfortable utensil ends are gentle on gums but not chewable, to avoid confusion."),
    ('Mealtimes happen at nursery, at grandparents\', out and about. The same tools, clean and together, wherever you are.',
     "Mealtimes happen at nursery, at grandparents', out and about. With the doddl travel case your baby can practice with the same tools, clean and together, wherever you are."),
    ('Lock it to the tray. When the bowl stays put, your child\'s entire focus goes on the spoon — which is exactly where it needs to be at Stage 1.',
     "Oval shape and higher back makes learning to scoop easier. Lower front makes food easy to see, important for sensory development. Strong suction keeps bowl in position and can be removed to reveal a non-slip base"),
    ('Your child starts grabbing the spoon and steering it themselves rather than just accepting yours. That\'s the pincer grip arriving. That\'s Stage 2.',
     "Your baby is eating more substantial meals and has started developing co-ordination and control. If these signs are visible, they're ready for stage 2"),
    ('Stage 2 · 12–18 months — Building control', 'Stage 2 · 12–24 months — Watch ME go!'),
    ('The pincer grip has arrived. Your toddler is grasping with real intention, scooping deliberately, and getting frustrated when the tools don\'t cooperate — which is a very good sign. This is when the tools need to keep up with the child, not hold them back.',
     "The desire for independence is growing and your toddler's hands are making their biggest development leap. The right tools make that transition happen faster — and with a lot less mess and stress. doddl stage 2 products are designed for when your toddler is showing these signs:"),
    ('Grasping and steering the spoon with intent', 'Eating more substantial meals'),
    ('Scooping food deliberately, not just batting at it', 'Desire to scoop effectively'),
    ('Self-feeding for part of most meals', 'Eager to stab food'),
    ('Showing frustration when utensils don\'t cooperate', 'Getting frustrated if you try to help!'),
    ('Introduce it alongside the baby cutlery — put both on the table and let them choose. They\'ll make the switch themselves when they\'re ready, usually within a few weeks.',
     "Expertly shaped and weighted handle makes self-feeding easy and develops grip strength. Builds co-ordination, confidence and independence while naturally encouraging the correct grip"),
    ('Ready for a plate alongside the bowl. Suction base keeps it stable while coordination is still building — same principle as the bowl at Stage 1.',
     "Oval shape keeps food in easy reach, raised back and lipped front keeps food and snacks on the plate reducing mess. Plate purposefully not sectioned to avoid creating food sensory issues. Strong suction keeps plate firmly in position."),
    ('Self-feeding most of most meals. Eating alongside the family. The bowl no longer needs the suction to stay put — they\'re not pushing it anymore.',
     "When your toddler is successfully self-feeding, is less inclined to throw their plate on the floor and would love to chop up their own food - they're ready for stage 3"),
    ('Stage 3 · 18 months – 3 years — Growing skills', 'Stage 3 · 2–5+ years — Independence unlocked'),
    ('Self-feeding is now the norm, not the exception. Your child is eating alongside the rest of the family, managing most textures, and developing the muscle memory that will carry them through to full independence. The tools at this stage need to be real — not toy-like, not plastic. They know the difference now.',
     "Your toddler's desire for independence is powerful. The right tools turn that determination into genuine skill. doddl stage 3 products will develop your toddler's fine motor-skills at mealtimes and beyond. When your toddler shows these signs, they're ready for stage 3."),
    ('Self-feeding confidently at most meals', 'Using a fork and spoon successfully'),
    ('Eating alongside the family at the table', 'Growing confidence at mealtimes'),
    ('Managing more food textures independently', 'Interest in chopping their own food'),
    ('Wanting adult-looking tools, not baby ones', 'Not swiping their plate or bowl from the table'),
    ('One small change. Pop the suction base off. Same bowl, now a regular one that they\'ve earned. The bowl doesn\'t change — the child has.',
     "One small change. Remove the suction base. Same ergonomic bowl, now a regular one with non-slip to keep supporting your child as they refine their skills. The bowl doesn't change — the child has."),
    ('Same upgrade as the bowl. The plate has been with suction since Stage 2 — they\'re ready to eat from it free-standing now. Do both at the same time.',
     "Same upgrade as the bowl. The plate has been with suction since Stage 2 — your child is ready to eat from it suction free. The non slip base will keep the plate stable as they learn how to use a 'grown up' plate."),
    # Reviews
    ('We got this as a baby shower gift and I genuinely didn\'t realise how much thought had gone into it. Eighteen months in and we\'ve just moved to Stage 2 — everything clicked exactly when the guide said it would. The saving compared to buying it all separately is real.',
     'I purchased this as a gift, for my great-nephew. I did my research, and chose doddl after reading reviews, and watching videos. His Mother was very happy with the set; not only with the good quality, but also with the ease that my great-nephew was able to use the products, and use the bowl to eat his cereal. I am really happy with this purchase. Thank you.'),
    ('Sarah M. — Verified purchase · Bundle Box', 'Sarah R - verified purchase'),
    ('Bought this for my sister\'s baby shower. She called me a year later to say she was moving onto Stage 2 and still getting use out of everything in the box. That\'s exactly what you want from a gift — something that keeps giving. The packaging is beautiful too.',
     'Fantastic first baby food set. Bought it for my Grandaughter for her first Christmas visit to Nannie\'s house she absolutely loved it and it\'s helped no end with her weaning 🥰'),
    ('Emma R. — Verified purchase · Bundle Box', 'Sonya F. - verified purchase'),
    # Gift section
    ('Give before weaning. The cool box sits on the nursery shelf until weaning starts — then delivers from Stage 1 all the way to independence. Parents don\'t need to think about cutlery again for five years.',
     "Give before weaning. The premium box sits on the nursery shelf until weaning starts — then delivers from Stage 1 all the way to independence. Parents don't need to think about cutlery again for five years."),
    ('Give at 12 months. Stage 1 is already in use. Everything from Stage 2 onwards is waiting. A gift that has four more years of life left in it the moment it\'s unwrapped.',
     "Give at 12 months. Stage 1 is already in use and can overlap to stage 2. Everything from Stage 2 onwards is waiting. A gift that has four more years of life left in it the moment it's unwrapped."),
    ('Any time before weaning. Removes every future decision about what cutlery to buy, at what stage, and in which colour. It\'s all there, in order, ready when the child is.',
     "Any time before weaning. This set removes every future worry about what tableware to buy, at what stage, and in which colour. It's all there, in order, ready when their child is."),
    # Final CTA
    ('From first spoon to the family dinner table — everything they need, nothing they don\'t.',
     'From first spoon to the family dinner table. Tiny hands. Big development. Every mealtime.'),
]
for old, new in bundle_replacements:
    rep('bundle', old, new)

# ═══════════════════════════════════════════════════════════
# SHOP BY CATEGORY — public/prototypes/category/desktop.html
# ═══════════════════════════════════════════════════════════
print('\n── Shop by Category ──')

cat_replacements = [
    ('Engineered for tiny hands just starting out. The right weight, the right length, the right grip — designed for exactly where your baby is right now, not where they\'ll be in six months.',
     "Engineered for tiny hands just starting out. The right weight, the right length, the right handle shape — designed for exactly where your baby is right now but helping advance their development"),
    ('Short handle — the correct length for 0–12 month hand span',
     "Compact handles can be held in your baby's basic grasp but encourage the development of the more advanced pincer grip"),
    ('Soft ergonomic tip — safe for new teeth and sensitive gums',
     'Smooth comfortable utensil ends - safe for new teeth and sensitive gums'),
    ('Weighted for the grip your baby actually has right now',
     'Short handles avoid the gag risk presented by long handles and are weighted for the strength your baby actually has right now'),
    ("doddl's ergonomic design means babies succeed from the very first try. That early confidence matters enormously for development.",
     "The cutlery set fits beautifully in little hands, helping babies build independence and confidence with self-feeding. They are short and even though the handle is chunkier they are super light. I love how well it supports fine motor skill development and encourages proper grip from early on, key steps in learning to eat independently."),
    ('— Katie Rawlings, Paediatric OT', 'The Baby Nutritionist — Katia Balducci'),
    ('When the pincer grip arrives and self-feeding becomes the goal, step up to Toddler Cutlery — sized for growing hands.',
     "When your baby has developed some hand-eye co-ordination, they're able to consistently move food from the bowl to their mouth and are eating more substantial meals, you'll need the best cutlery for toddlers. Time for stage 2."),
    ('Toddler Cutlery · Stage 1–4', 'Toddler Cutlery · Stage 1–3'),
    ('Tools that grow with them', 'Tools designed for success'),
    ('As the pincer grip develops and self-feeding becomes the goal, the right cutlery makes every meal a win. Sized for toddler hands, designed for independence — from 12 months to the family table.',
     "As your toddler's independence develops and self-feeding every meal becomes the goal, the right cutlery makes all the difference. Sized for toddler hands, designed for independent eating, less mess and less stress — from 12 months to school ready."),
    ('Engineered for the developing pincer grip — 12 months onwards',
     'Engineered for the developing grips, growing independence and more substantial meals — 12 months onwards'),
]
for old, new in cat_replacements:
    rep('category', old, new)

# ═══════════════════════════════════════════════════════════
# Save all files
# ═══════════════════════════════════════════════════════════
print('\n── Saving files ──')
for key, path in FILES.items():
    if pages[key] is not None:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(pages[key])
        print(f'  saved: {path} ({changed[key]} replacements)')

print('\n── Summary ──')
total = sum(changed.values())
for k, n in changed.items():
    print(f'  {FILES[k]}: {n} replacements')
print(f'  TOTAL: {total} replacements applied')
print('\nDone. Review changes with: git diff public/prototypes/')
