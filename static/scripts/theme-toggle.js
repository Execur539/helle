
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('game-buttons-container');
    const searchInput = document.getElementById('search-input');
    let gameData = [];

    // Fetch game data
    fetch('/pages/games.json')
        .then(response => {
            if (!response.ok) throw new Error('Failed to fetch games data');
            return response.json();
        })
        .then(data => {
            gameData = data.gameButtons || [];
            renderGames(gameData);
        })
        .catch(error => {
            console.error('Error loading game buttons:', error);
            container.innerHTML = '<p class="text-red-500">Failed to load games. Please try again later.</p>';
        });

    // Handle search
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        const filteredGames = gameData.filter(game => game.text.toLowerCase().includes(searchTerm));
        renderGames(filteredGames);
    });

    // Render games
    function renderGames(games) {
        container.innerHTML = ''; // Clear existing content
        if (games.length === 0) {
            container.innerHTML = '<p class="text-gray-500">No games found.</p>';
            return;
        }

        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid gap-6';
        gridContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';

        games.forEach(game => {
            const gameButton = document.createElement('a');
            gameButton.href = game.link;
            gameButton.className =
                'relative block w-full max-w-sm h-52 bg-base-200 rounded overflow-hidden shadow-md transition-transform hover:scale-105';

            const img = document.createElement('div');
            img.style.backgroundImage = `url(${game.image})`;
            img.style.backgroundSize = 'cover';
            img.style.backgroundPosition = 'center';
            img.className = 'absolute inset-0 w-full h-full';

            const title = document.createElement('div');
            title.className =
                'absolute bottom-0 w-full bg-black bg-opacity-75 text-white text-center text-sm py-1';
            title.textContent = game.text;

            gameButton.appendChild(img);
            gameButton.appendChild(title);
            gridContainer.appendChild(gameButton);
        });

        container.appendChild(gridContainer);
    }

    const themeToggle = document.querySelector('.theme-controller');
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('dark-theme', themeToggle.checked);
    });
});