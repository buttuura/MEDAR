function toggleMenu() {
  const links = document.querySelector('.nav-links');
  const button = document.querySelector('.menu-toggle');
  if (!links) return;

  links.classList.toggle('open');
  if (button) {
    button.innerText = links.classList.contains('open') ? '×' : '☰';
  }
}

document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    const links = document.querySelector('.nav-links');
    const button = document.querySelector('.menu-toggle');
    if (links) links.classList.remove('open');
    if (button) button.innerText = '☰';
  });
});

const memberNavigationLinks = document.querySelectorAll(
  '.nav-links a[href="become-member.html"]'
);
const loginNavigationLinks = document.querySelectorAll('.nav-links a[href="login.html"]');

fetch('/api/auth/me')
  .then(response => {
    if (response.ok) {
      memberNavigationLinks.forEach(link => link.removeAttribute('hidden'));
      loginNavigationLinks.forEach(link => {
        link.textContent = 'Log Out';
        link.href = '#logout';
        link.classList.remove('active');
        link.addEventListener('click', async event => {
          event.preventDefault();
          link.textContent = 'Logging out…';
          try {
            const csrfResponse = await fetch('/api/auth/csrf');
            if (!csrfResponse.ok) {
              throw new Error('Unable to start a secure logout. Please try again.');
            }
            const { token } = await csrfResponse.json();
            const logoutResponse = await fetch('/api/auth/logout', {
              method: 'POST',
              headers: { 'X-XSRF-TOKEN': token }
            });
            if (!logoutResponse.ok) {
              throw new Error('Unable to log out. Please try again.');
            }
            window.location.replace('/index.html');
          } catch (error) {
            console.error('Unable to log out.', error);
            link.textContent = 'Log Out';
            window.alert(error.message || 'Unable to log out. Please try again.');
          }
        });
      });
    } else if (response.status !== 401) {
      console.error('Unable to verify the account before updating navigation.');
    }
  })
  .catch(error => {
    console.error('Unable to verify the account before updating navigation.', error);
  });
