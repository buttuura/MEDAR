// Toggle mobile hamburger menu
function toggleMenu(){
  const links=document.querySelector('.nav-links');
  const btn=document.querySelector('.menu-toggle');
  if(links){
    links.classList.toggle('open');
    if(btn) btn.innerText = links.classList.contains('open') ? '×' : '☰';
  }
}

// Close menu when a nav link is clicked
document.querySelectorAll('.nav-links a').forEach(a=>{
  a.addEventListener('click',()=>{
    const links=document.querySelector('.nav-links');
    const btn=document.querySelector('.menu-toggle');
    if(links) links.classList.remove('open');
    if(btn) btn.innerText='☰';
  });
});

// Scroll to form
function scrollToForm(){
  const el=document.getElementById('memberForm');
  if(el) el.scrollIntoView({behavior:'smooth'});
}

// Generate Member ID and Save to Local Database (for now)
const registerForm=document.getElementById('registerForm');
if(registerForm){
  registerForm.addEventListener('submit', function(e){
    e.preventDefault();
    
    const fullName = document.getElementById('fullName').value;
    const email = document.getElementById('email').value;
    const country = document.getElementById('country').value;
    const status = document.getElementById('status').value;
    
    // Generate ID: FMU-YEAR-RANDOM
    const year = new Date().getFullYear();
    const random = Math.floor(1000 + Math.random() * 9000);
    const memberId = `FMU-${year}-${random}`;

    // Update UI Card
    document.getElementById('idName').innerText = `Member: ${fullName}`;
    document.getElementById('idNumber').innerText = `ID: ${memberId}`;

    // Save to browser database (LocalStorage) - later we connect to MongoDB
    const members = JSON.parse(localStorage.getItem('medar_members') || '[]');
    members.push({ fullName, email, country, status, memberId, date: new Date().toISOString() });
    localStorage.setItem('medar_members', JSON.stringify(members));

    alert(`Welcome ${fullName}! You are now a member. Your Member ID is ${memberId}. Data saved!`);

    // TODO: This is where we will call backend API
    // fetch('/api/register', { method:'POST', body: JSON.stringify({fullName,email,country,status}) })
  });
}

// For backend, we will use:
// Node.js + Express + MongoDB
// API: POST /api/members/register
