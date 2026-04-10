const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Concepts
    const concepts = [
      ['guest', 'Guest', 'Guests', 'pi pi-users', 'Invited convention guests'],
      ['staff', 'Staff', 'Staff', 'pi pi-id-card', 'Convention staff members'],
      ['schedule', 'Event', 'Schedule', 'pi pi-calendar', 'Convention events'],
      ['venue', 'Venue', 'Venues', 'pi pi-map-marker', 'Convention venues'],
      ['pairing', 'Pairing', 'Pairings', 'pi pi-link', 'Guest-staff assignments'],
      ['prep_item', 'Prep Item', 'Prep Tracker', 'pi pi-check-square', 'Pre-event tasks'],
      ['transport', 'Transport', 'Transport', 'pi pi-car', 'Transport bookings'],
      ['convention', 'Convention', 'Conventions', 'pi pi-globe', 'Convention instance'],
      ['guest_registry', 'Guest Registry', 'Guest Registry', 'pi pi-database', 'Multi-year guest history'],
    ]
    for (const [key, name, plural, icon, desc] of concepts) {
      await client.query('INSERT INTO ontology_concepts (key, name, plural_name, icon, description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key, version) DO NOTHING', [key, name, plural, icon, desc])
    }
    console.log('Concepts:', concepts.length)

    // 2. Roles
    const roles = [['director','Director',100,false],['department_head','Department Head',80,false],['coordinator','Coordinator',60,true],['liaison','Liaison',40,true],['interpreter','Interpreter',30,true],['volunteer','Volunteer',10,true],['viewer','Viewer',5,false]]
    for (const [key, name, pri, isOp] of roles) {
      await client.query('INSERT INTO roles (key, name, priority, is_operational) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING', [key, name, pri, isOp])
    }
    console.log('Roles:', roles.length)

    // 3. Venues
    const venues = [['Main Events Hall A','ballroom'],['Main Events Hall B','ballroom'],['Panel Room 1','meeting_room'],['Panel Room 2','meeting_room'],['Autograph Hall','ballroom'],['Green Room','breakout'],['Press Room','meeting_room'],['Restaurant (Sheraton Hotel)','other']]
    for (const [name, type] of venues) {
      await client.query('INSERT INTO venues (name, type, capacity, equipment, properties) VALUES ($1,$2,500,$3,$4)', [name, type, JSON.stringify([]), JSON.stringify({})])
    }
    console.log('Venues:', venues.length)

    // 4. Guests
    const guestData = [
      {name:'Tanaka Ichiro',type:'JP',dept:'Anime',status:'confirmed',company:'Sunrise Studios',interp:true,bio:'Veteran voice actor known for roles in Gundam and My Hero Academia.'},
      {name:'Suzuki Yui',type:'JP',dept:'Anime',status:'travel_arranged',company:'Shueisha',interp:true,bio:'Award-winning manga artist, creator of Starlight Requiem.'},
      {name:'Yamamoto Ken',type:'JP',dept:'Industry',status:'confirmed',company:'Toei Animation',interp:true,bio:'Acclaimed anime director.'},
      {name:'Nakamura Rin',type:'JP',dept:'Music',status:'arrived',company:'Sony Music Japan',interp:true,bio:'J-pop and anisong singer.'},
      {name:'Alex Chen',type:'NA',dept:'Cosplay',status:'confirmed',company:'Independent',interp:false,bio:'Award-winning cosplayer and prop maker.'},
      {name:'Sarah Mitchell',type:'NA',dept:'Panels',status:'invited',company:'Mitchell Media LLC',interp:false,bio:'Anime YouTuber with 2.3M subscribers.'},
      {name:'Jordan Lee',type:'NA',dept:'Anime',status:'confirmed',company:'Funimation / Crunchyroll',interp:false,bio:'English voice actor for 50+ anime dubs.'},
      {name:'Maria Garcia',type:'NA',dept:'Artists',status:'draft',company:'Independent Artist',interp:false,bio:'Digital artist specializing in anime-inspired works.'},
      {name:'Takeshi Mori',type:'JP',dept:'Gaming',status:'confirmed',company:'Bandai Namco',interp:true,bio:'Game designer, led Tales of Arise.'},
      {name:'Emily Park',type:'NA',dept:'Music',status:'travel_arranged',company:'K-Wave Dance Studio',interp:false,bio:'Choreographer for anime and K-pop dance.'},
      {name:'David Kim',type:'Industry',dept:'Industry',status:'confirmed',company:'Aniplex of America',interp:false,bio:'VP of Marketing at Aniplex.'},
      {name:'Luna Martinez',type:'NA',dept:'Music',status:'arrived',company:'Independent Musician',interp:false,bio:'Multi-instrumentalist performing anime covers.'},
    ]
    const guestIds = []
    for (const g of guestData) {
      const r = await client.query('INSERT INTO guests (name,type,department,status,company,properties) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [g.name, g.type, g.dept, g.status, g.company, JSON.stringify({bio:g.bio,interpreter_required:g.interp})])
      guestIds.push(r.rows[0].id)
    }
    console.log('Guests:', guestIds.length)

    // 5. Staff
    const staffData = [
      {name:'Hiro Tanaka',role:'department_head',dept:'Anime',email:'hiro@ab.org'},
      {name:'Kevin Nakamura',role:'liaison',dept:'Anime',email:'kevin@ab.org'},
      {name:'Yuki Sato',role:'interpreter',dept:'Anime',email:'yuki@ab.org'},
      {name:'Marcus Johnson',role:'liaison',dept:'Anime',email:'marcus@ab.org'},
      {name:'Rachel Torres',role:'coordinator',dept:'Anime',email:'rachel@ab.org'},
      {name:'Tomoko Hayashi',role:'liaison',dept:'Music',email:'tomoko@ab.org'},
      {name:'Chris Williams',role:'interpreter',dept:'Music',email:'chris@ab.org'},
      {name:'Aisha Patel',role:'coordinator',dept:'Music',email:'aisha@ab.org'},
      {name:'Sam Chen',role:'liaison',dept:'Cosplay',email:'sam@ab.org'},
      {name:'Diana Rodriguez',role:'coordinator',dept:'Cosplay',email:'diana@ab.org'},
      {name:'Lisa Park',role:'liaison',dept:'Industry',email:'lisa@ab.org'},
      {name:'Jake Morrison',role:'coordinator',dept:'Industry',email:'jake@ab.org'},
      {name:'Mei Lin',role:'liaison',dept:'Panels',email:'mei@ab.org'},
      {name:'Derek Chang',role:'coordinator',dept:'Artists',email:'derek@ab.org'},
      {name:'Nina Volkov',role:'liaison',dept:'Gaming',email:'nina@ab.org'},
      {name:'Tom Bradley',role:'department_head',dept:'Music',email:'tom@ab.org'},
      {name:'Ana Costa',role:'volunteer',dept:'Anime',email:'ana@ab.org'},
      {name:'Ben Foster',role:'volunteer',dept:'Music',email:'ben@ab.org'},
      {name:'Kenji Watanabe',role:'interpreter',dept:'Industry',email:'kenji@ab.org'},
      {name:'Priya Sharma',role:'volunteer',dept:'Music',email:'priya@ab.org'},
    ]
    const staffIds = []
    for (const s of staffData) {
      const r = await client.query('INSERT INTO staff (name,email,role_key,department,properties) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [s.name, s.email, s.role, s.dept, JSON.stringify({})])
      staffIds.push(r.rows[0].id)
    }
    console.log('Staff:', staffIds.length)

    // 6. Venue IDs
    const venueRows = await client.query('SELECT id, name FROM venues')
    const venueMap = {}
    for (const v of venueRows.rows) venueMap[v.name] = v.id

    // 7. Events
    const events = [
      {name:'Opening Ceremony',type:'Panel',g:0,v:'Main Events Hall A',d:'2026-04-03',s:'10:00',e:'11:00'},
      {name:'Voice Acting Masterclass',type:'Panel',g:0,v:'Panel Room 1',d:'2026-04-03',s:'13:00',e:'14:30'},
      {name:'Manga Creation Workshop',type:'Panel',g:1,v:'Panel Room 2',d:'2026-04-03',s:'11:00',e:'12:30'},
      {name:'Tanaka Autograph Session',type:'Autograph Session',g:0,v:'Autograph Hall',d:'2026-04-03',s:'15:00',e:'16:30'},
      {name:'Guest Welcome Dinner',type:'Meal',g:0,v:'Restaurant (Sheraton Hotel)',d:'2026-04-03',s:'18:00',e:'20:00'},
      {name:'Suzuki Art Demo',type:'Panel',g:1,v:'Panel Room 1',d:'2026-04-04',s:'10:00',e:'11:30'},
      {name:'Industry Keynote',type:'Panel',g:2,v:'Main Events Hall A',d:'2026-04-04',s:'14:00',e:'15:00'},
      {name:'Nakamura Concert',type:'Other',g:3,v:'Main Events Hall B',d:'2026-04-04',s:'19:00',e:'21:00'},
      {name:'Cosplay Workshop',type:'Panel',g:4,v:'Panel Room 2',d:'2026-04-04',s:'11:00',e:'12:30'},
      {name:'Jordan Lee VA Panel',type:'Panel',g:6,v:'Panel Room 1',d:'2026-04-04',s:'16:00',e:'17:30'},
      {name:'Gaming Industry Panel',type:'Panel',g:8,v:'Panel Room 1',d:'2026-04-05',s:'10:00',e:'11:30'},
      {name:'Dance Workshop',type:'Panel',g:9,v:'Main Events Hall B',d:'2026-04-05',s:'11:00',e:'12:30'},
      {name:'Aniplex Presentation',type:'Panel',g:10,v:'Main Events Hall A',d:'2026-04-05',s:'13:00',e:'14:00'},
      {name:'Luna Concert',type:'Other',g:11,v:'Main Events Hall B',d:'2026-04-05',s:'15:00',e:'16:30'},
      {name:'Closing Ceremony',type:'Other',g:0,v:'Main Events Hall A',d:'2026-04-05',s:'17:00',e:'18:00'},
    ]
    for (const ev of events) {
      await client.query('INSERT INTO schedule_events (name,event_type,venue_id,start_time,end_time,status,properties) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [ev.name, ev.type, venueMap[ev.v]||null, ev.d+'T'+ev.s+':00', ev.d+'T'+ev.e+':00', 'confirmed',
         JSON.stringify({guest_id:guestIds[ev.g],guest_name:guestData[ev.g].name,date:ev.d,venue_name:ev.v})])
    }
    console.log('Events:', events.length)

    // 8. Pairings
    const pairs = [{g:0,s:1,r:'Main Liaison'},{g:0,s:2,r:'Interpreter'},{g:1,s:3,r:'Main Liaison'},{g:1,s:2,r:'Interpreter'},{g:2,s:10,r:'Main Liaison'},{g:2,s:18,r:'Interpreter'},{g:3,s:5,r:'Main Liaison'},{g:3,s:6,r:'Interpreter'},{g:4,s:8,r:'Main Liaison'},{g:6,s:1,r:'Main Liaison'},{g:8,s:14,r:'Main Liaison'},{g:8,s:18,r:'Interpreter'},{g:9,s:17,r:'Main Liaison'},{g:10,s:10,r:'Main Liaison'},{g:11,s:5,r:'Main Liaison'}]
    for (const p of pairs) {
      await client.query('INSERT INTO pairings (guest_id,staff_id,role,properties) VALUES ($1,$2,$3,$4)',
        [guestIds[p.g], staffIds[p.s], p.r, JSON.stringify({status:'active'})])
    }
    console.log('Pairings:', pairs.length)

    // 9. Prep items
    let prepCount = 0
    const tasks = ['Confirm flight itinerary','Hotel room assignment','Badge and lanyard prepared','Submit dietary requirements','Welcome packet assembled']
    for (let gi = 0; gi < 8; gi++) {
      for (let ti = 0; ti < tasks.length; ti++) {
        const st = gi < 4 ? 'complete' : (ti < 3 ? 'complete' : ti < 4 ? 'in_progress' : 'not_started')
        await client.query('INSERT INTO prep_items (name,guest_id,status,due_date,properties) VALUES ($1,$2,$3,$4,$5)',
          [tasks[ti], guestIds[gi], st, '2026-03-25', JSON.stringify({guest_name:guestData[gi].name,owner:staffData[Math.min(gi,14)].name})])
        prepCount++
      }
    }
    console.log('Prep:', prepCount)

    // 10. Transport
    const trans = [
      {g:0,type:'arrival',from:'Boston Logan Airport (Terminal E)',to:'Sheraton Boston Hotel',time:'2026-04-02T15:30:00',driver:'Mike Sullivan',vehicle:'Black sedan'},
      {g:1,type:'arrival',from:'Boston Logan Airport (Terminal E)',to:'Sheraton Boston Hotel',time:'2026-04-02T10:15:00',driver:'Tom Reilly',vehicle:'Black sedan'},
      {g:2,type:'arrival',from:'Boston Logan Airport (Terminal E)',to:'Sheraton Boston Hotel',time:'2026-04-02T19:00:00',driver:'Mike Sullivan',vehicle:'Black SUV'},
      {g:3,type:'arrival',from:'Boston Logan Airport (Terminal E)',to:'Sheraton Boston Hotel',time:'2026-04-02T13:00:00',driver:'James OBrien',vehicle:'Black SUV'},
      {g:4,type:'arrival',from:'Boston Logan Airport (Terminal B)',to:'Sheraton Boston Hotel',time:'2026-04-02T17:00:00',driver:'Dave Kowalski',vehicle:'Minivan'},
      {g:0,type:'departure',from:'Sheraton Boston Hotel',to:'Boston Logan Airport (Terminal E)',time:'2026-04-06T07:00:00',driver:'Mike Sullivan',vehicle:'Black sedan'},
      {g:1,type:'departure',from:'Sheraton Boston Hotel',to:'Boston Logan Airport (Terminal E)',time:'2026-04-06T08:30:00',driver:'Tom Reilly',vehicle:'Black sedan'},
    ]
    for (const t of trans) {
      await client.query('INSERT INTO transport_bookings (guest_id,booking_type,status,pickup_location,dropoff_location,scheduled_time,driver_name,vehicle_info,properties) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [guestIds[t.g], t.type, 'confirmed', t.from, t.to, t.time, t.driver, t.vehicle, JSON.stringify({guest_name:guestData[t.g].name})])
    }
    console.log('Transport:', trans.length)

    await client.query('COMMIT')
    console.log('\nSeed complete!')

    const tbls = ['ontology_concepts','roles','venues','guests','staff','schedule_events','pairings','prep_items','transport_bookings']
    for (const t of tbls) {
      const r = await client.query('SELECT count(*) as c FROM ' + t)
      console.log('  ' + t + ': ' + r.rows[0].c)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', e.message)
  } finally {
    client.release()
    await pool.end()
  }
}
seed()
