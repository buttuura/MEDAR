const authForm = document.querySelector('#loginForm, #signupForm');
const authError = document.getElementById('authError');

document.querySelectorAll('.password-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const passwordInput = toggle.parentElement.querySelector('input');
    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    toggle.setAttribute('aria-pressed', String(!isVisible));
    toggle.classList.toggle('is-visible', !isVisible);
  });
});

function getMemberApplicationPath() {
  const requestedPath = new URLSearchParams(window.location.search).get('next');
  if (requestedPath && requestedPath.startsWith('/') && !requestedPath.startsWith('//')) {
    return requestedPath;
  }
  return '/become-member.html';
}

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf');
  if (!response.ok) {
    throw new Error('Unable to start a secure session. Please try again.');
  }
  return (await response.json()).token;
}

async function redirectIfSignedIn() {
  const response = await fetch('/api/auth/me');
  if (response.ok) {
    window.location.replace(getMemberApplicationPath());
    return;
  }
  if (response.status !== 401) {
    throw new Error('Unable to verify your account. Please refresh and try again.');
  }
}

if (authForm) {
  redirectIfSignedIn().catch(error => {
    authError.textContent = error.message || 'Unable to verify your account. Please refresh and try again.';
    authError.hidden = false;
  });
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    authError.hidden = true;
    authForm.querySelector('button[type="submit"]').disabled = true;

    const formData = new FormData(authForm);
    const isSignup = authForm.id === 'signupForm';
    const payload = isSignup
      ? {
          fullName: formData.get('fullName'),
          email: formData.get('email'),
          password: formData.get('password')
        }
      : {
          email: formData.get('email'),
          password: formData.get('password')
        };

    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/auth/${isSignup ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': csrfToken
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.detail || result.error || result.message ||
          'Unable to sign in. Please check your details and try again.'
        );
      }

      window.location.replace(getMemberApplicationPath());
    } catch (error) {
      authError.textContent = error.message || 'Something went wrong. Please try again.';
      authError.hidden = false;
      authForm.querySelector('button[type="submit"]').disabled = false;
    }
  });
}
