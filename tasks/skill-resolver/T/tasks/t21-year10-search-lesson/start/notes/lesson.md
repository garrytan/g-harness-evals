# Lesson 7: binary search (Thursday, year 10, 25 minutes, projector)

- Open with the game: I think of a number between 1 and 100; you get 7 guesses with "higher" or "lower".
- Sorted list of 16 numbers: 3 8 12 17 21 26 30 37 41 45 52 58 63 70 77 84
- Find 63. Show low, mid and high moving, and grey out the half we throw away each time.
  - low=0, high=15, mid=7 (37): 63 is bigger, low=8
  - low=8, high=15, mid=11 (58): bigger, low=12
  - low=12, high=15, mid=13 (70): smaller, high=12
  - low=12, high=12, mid=12 (63): found, 4 looks
- End: why it is fast. Each look halves what is left: 16, 8, 4, 2, 1. A million sorted items need about 20 looks.
- Video should be 2 to 3 minutes. No voiceover; I talk over it in class.
