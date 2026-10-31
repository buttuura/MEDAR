// Live Preview
document.getElementById('fullName').addEventListener('input', e => {
  document.getElementById('pName').innerText = `Full Name: ${e.target.value}`;
});
document.getElementById('country').addEventListener('change', e => {
  document.getElementById('pCountry').innerText = `Country: ${e.target.value}`;
});
document.getElementById('memberStatus').addEventListener('change', e => {
  document.getElementById('pStatus').innerText = `Status: ${e.target.value}`;
});

// Full Registration
document.getElementById('fullRegisterForm').addEventListener('submit', function(e){
  e.preventDefault();

  const services = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map(c=>c.value);

  const data = {
    fullName: document.getElementById('fullName').value,
    dob: document.getElementById('dob').value,
    gender: document.getElementById('gender').value,
    nin: document.getElementById('nin').value,
    phone: document.getElementById('phone').value,
    whatsapp: document.getElementById('whatsapp').value,
    email: document.getElementById('email').value,
    country: document.getElementById('country').value,
    city: document.getElementById('city').value,
    status: document.getElementById('memberStatus').value,
    agency: document.getElementById('agency').value,
    servicesNeeded: services,
    emergencyName: document.getElementById('emName').value,
    emergencyPhone: document.getElementById('emPhone').value,
    memberId: `FMU-${new Date().getFullYear()}-${Math.floor(1000+Math.random()*9000)}`,
    date: new Date().toISOString()
  };

  // 1. Save locally for now
  const members = JSON.parse(localStorage.getItem('medar_members') || '[]');
  members.push(data);
  localStorage.setItem('medar_members', JSON.stringify(members));

  // 2. Show ID
  document.getElementById('pID').innerText = `ID: ${data.memberId}`;
  alert(`Success! ${data.fullName}, you are now a member.\nYour Member ID: ${data.memberId}\n\nServices selected: ${services.join(', ') || 'None'}`);

  // 3. TODO BACKEND - This is where JavaScript backend will save to MongoDB
  // fetch('http://localhost:5000/api/members/register', {
  //   method: 'POST',
  //   headers: {'Content-Type':'application/json'},
  //   body: JSON.stringify(data)
  // })
});