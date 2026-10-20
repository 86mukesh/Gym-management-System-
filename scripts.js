document.addEventListener('DOMContentLoaded', () => {
  const navToggles = document.querySelectorAll('.toggle');
  const navLists = document.querySelectorAll('.navbar ol');

  navToggles.forEach((toggle) => {
    const navList = toggle.closest('.navbar')?.querySelector('ol');

    if (!navList) return;

    toggle.addEventListener('click', () => {
      const isOpen = navList.classList.toggle('active');
      toggle.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    navList.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navList.classList.remove('active');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  });

  const workoutSelect = document.getElementById('workout-price');
  const workoutCards = document.querySelectorAll('.workout-card');

  if (workoutSelect && workoutCards.length) {
    const applyWorkoutFilter = () => {
      const selectedPrice = Number(workoutSelect.value) || 0;

      workoutCards.forEach((card) => {
        const cardPrice = Number(card.dataset.price) || 0;
        const shouldShow = selectedPrice === 0 || cardPrice <= selectedPrice;
        card.style.display = shouldShow ? '' : 'none';
      });
    };

    workoutSelect.addEventListener('change', applyWorkoutFilter);
    applyWorkoutFilter();
  }

  document.querySelectorAll('.rating-stars').forEach((starGroup) => {
    const inputs = starGroup.querySelectorAll('input[type="radio"]');
    const output = starGroup.closest('fieldset')?.querySelector('.rating-output');

    inputs.forEach((input) => {
      input.addEventListener('change', () => {
        if (output) {
          output.textContent = `You rated ${input.value} / 5`;
        }
      });
    });
  });

  const contactForm = document.getElementById('contact-form');
  const contactStatus = document.getElementById('contact-status');

  if (contactForm && contactStatus) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(contactForm);
      const name = String(formData.get('name') || 'there');
      contactStatus.textContent = `Thanks, ${name}! This demo form is not sent or saved.`;
      contactForm.reset();
    });
  }

  const paymentButtons = document.querySelectorAll('.payment-option');
  const paymentStatus = document.getElementById('payment-status');

  paymentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const method = button.dataset.paymentMethod || 'Selected UPI app';

      paymentButtons.forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });

      if (paymentStatus) {
        paymentStatus.textContent = `${method} selected. Payment is not processed in this demo.`;
      }
    });
  });

  const galleryButtons = document.querySelectorAll('.gallery-filters button[data-filter]');
  const galleryFigures = document.querySelectorAll('.gallery-grid figure[data-category]');

  if (galleryButtons.length && galleryFigures.length) {
    const applyGalleryFilter = (filter) => {
      galleryButtons.forEach((button) => {
        const isActive = button.dataset.filter === filter;
        button.setAttribute('aria-pressed', String(isActive));
      });

      galleryFigures.forEach((figure) => {
        const category = figure.dataset.category;
        const shouldShow = filter === 'all' || category === filter;
        figure.style.display = shouldShow ? '' : 'none';
      });
    };

    galleryButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyGalleryFilter(button.dataset.filter || 'all');
      });
    });
  }
});
