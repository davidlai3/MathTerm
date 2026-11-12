# mathterm demo

Euler's identity $e^{i\pi} + 1 = 0$ sits inline, and so does $\alpha^2 + \beta^2$.
Inline fractions like $\frac{1}{2} + \frac{a}{b}$ fit in their row.
Taller ones like $\frac{\frac{1}{2}}{x+1}$ or $\sum_{i=1}^{n} i$ get a blank line above and below.
The next line is normal again.

## Display math

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

$$
A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
$$

## Markdown

- **Bold**, *italic*, ~~struck~~ and `inline code` (where `$x$` stays code)
- a [link](https://katex.org) and snake_case_names left alone
  - nested item with $\sqrt{2}$

> A quote: costs $5 and $10 are not math.

---

```python
def f(x):  # $not_math$ in code
    return x ** 2
```
