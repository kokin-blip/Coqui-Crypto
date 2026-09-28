# Quant resources corpus review — 2026-09-26

Source: [LucindaYa/quant-resources](https://github.com/LucindaYa/quant-resources), `master` as retrieved on 2026-09-26.

## Scope and reading status

The repository contains 63 PDFs (505,595,583 bytes; 16,834 PDF pages). Embedded text was extracted from every file; six files with insufficient embedded text were also OCR-processed. Three pairs have identical extracted text: `PRML_Translation` / `PRML中文版`, `United States Equity Version 3` / `United States Equity`, and the two copies of *Successful Algorithmic Trading*. The corpus was surveyed by title, available text, contents, and relevant sections; the directly applicable works below received a closer review. This is **not** a claim that every page of all 63 PDFs has been read word for word. OCR has recognition errors, especially in Chinese-language material, so exact claims from those scans need visual verification.

The PDFs include third-party books. This note records original conclusions and pointers; it does not copy their text or grant redistribution rights.

## Findings for Coqui

1. **Validation is the highest-value lesson.** *Advances in Financial Machine Learning* discusses time-aware validation, purging/embargo for overlapping labels, and backtest overfitting. Bailey et al.'s *Probability of Backtest Overfitting* shows why choosing the best of many trials can make a backtest misleading. Coqui should record every candidate and parameter search, preserve untouched chronological evaluation periods, and compare net-of-cost results against simple baselines before promoting any new strategy.
2. **More frequent trades require a measurable edge after costs.** Chan's *Algorithmic Trading* explicitly treats its simplified example backtests as illustrative, not cost-complete. Kaufman's *Trading Systems and Methods* warns that too many filters can overfit or suppress trades, and that fast trading is sensitive to transaction costs. Intraday candidates should be assessed on spread, slippage, fees, turnover, and exposure time, not trade count alone.
3. **Use ML as a testable signal or filter.** Aronson and Masters' *Statistically Sound Machine Learning for Algorithmic Trading of Financial Instruments* discusses model predictions, thresholds, overlapping targets, and walk-forward testing. A bounded Coqui worker that proposes a regime score or small exposure adjustment is a direct research hypothesis; it should start in shadow mode with versioned predictions and outcomes.
4. **Keep strategy, portfolio, and execution concerns distinct.** Narang's *Inside the Black Box* separates alpha, portfolio construction, risk, and execution. This supports independent TrendVol, intraday momentum, and relative-value candidate strategies feeding one host-owned paper execution path, rather than giving model workers direct brokerage authority.
5. **Pairs research does not transfer unchanged to this account.** Krauss's survey compares distance, cointegration, time-series, and other pairs approaches. Conventional pairs research often uses simultaneous long and short legs. The current Coqui Alpaca crypto paper path is long-only, so any rotation into an underperformer must be evaluated as a different strategy rather than assumed to inherit long-short pairs results.
6. **Order-book research is context, not immediate alpha.** The microstructure and HFT papers study spread, depth imbalance, liquidity, and latency, often in equities, futures, or FX. Coqui's Coinbase diagnostics can help explain trading conditions, but a Coinbase snapshot should not be treated as Alpaca execution data or a proven signal.

## Priority for the next research cycle

| Priority | Works | Coqui use |
| --- | --- | --- |
| Read closely | Bailey et al.; López de Prado; Aronson & Masters | Candidate registry, time-aware tests, ML worker evaluation |
| Read closely | Chan, Kaufman, Carver, Narang | Distinct strategy hypotheses, sizing, turnover, execution separation |
| Read closely | Krauss, Pole, Tsay | Relative-value definition, stationarity checks, regime change |
| Reference as needed | Madhavan and HFT/microstructure papers | Spread/depth diagnostics and execution-cost studies |
| Lower direct relevance | Equity factor, futures HFT, derivatives pricing, poker, generic ML/programming texts | Concepts may transfer, but their published results do not validate a crypto spot strategy |

## Corpus inventory

The page count is the PDF page count, which can differ from printed page numbers. “OCR extracted” means the text was recovered from page images for this review; it may contain recognition errors. OCR output and source PDFs are temporary research files and are not copied into Coqui.

| # | Pages | PDF | Focus | Reading status |
| ---: | ---: | --- | --- | --- |
| 1 | 36 | [A Guided Tour of the Market Microstructure Approach to Exchange Rate Determination.pdf](https://github.com/LucindaYa/quant-resources/blob/master/A%20Guided%20Tour%20of%20the%20Market%20Microstructure%20Approach%20to%20Exchange%20Rate%20Determination.pdf) | FX order flow | Text extracted |
| 2 | 272 | [A Quantitative Approach to Building Trading Strategies.pdf](https://github.com/LucindaYa/quant-resources/blob/master/A%20Quantitative%20Approach%20to%20Building%20Trading%20Strategies.pdf) | Alpha research | Text extracted |
| 3 | 225 | [ALGORITHMIC TRADING2.pdf](https://github.com/LucindaYa/quant-resources/blob/master/ALGORITHMIC%20TRADING2.pdf) | Momentum and mean reversion | Text extracted |
| 4 | 36 | [ANOMALIES AND MARKET EFFICIENCY.pdf](https://github.com/LucindaYa/quant-resources/blob/master/ANOMALIES%20AND%20MARKET%20EFFICIENCY.pdf) | Market anomalies | Text extracted |
| 5 | 393 | [Advances_in_Financial_Machine_Learning_001.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Advances_in_Financial_Machine_Learning_001.pdf) | Financial ML validation | Text extracted |
| 6 | 58 | [Algorithmic and High-frequency trading- an overview.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Algorithmic%20and%20High-frequency%20trading-%20an%20overview.pdf) | Algorithmic/HFT overview | Text extracted |
| 7 | 595 | [Algorithmic trading.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Algorithmic%20trading.pdf) | Direct market access | OCR extracted |
| 8 | 432 | [Applied Quantitative Methods for Trading and Investment.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Applied%20Quantitative%20Methods%20for%20Trading%20and%20Investment.pdf) | Applied quant methods | Text extracted |
| 9 | 45 | [Arbitrage, State Prices and Portfolio Theory Handbook of the Economics of Finance.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Arbitrage%2C%20State%20Prices%20and%20Portfolio%20Theory%20Handbook%20of%20the%20Economics%20of%20Finance.pdf) | Asset pricing theory | Text extracted |
| 10 | 331 | [Building Automated Trading Systems.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Building%20Automated%20Trading%20Systems.pdf) | Trading-system engineering | Text extracted |
| 11 | 187 | [Chasing the Same Signal.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Chasing%20the%20Same%20Signal.pdf) | Signal crowding | Text extracted |
| 12 | 45 | [Day Trading System.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Day%20Trading%20System.pdf) | Day-trading systems | OCR extracted |
| 13 | 435 | [Financial Instrument Pricing Using C++.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Financial%20Instrument%20Pricing%20Using%20C%2B%2B.pdf) | Derivatives software | Text extracted |
| 14 | 522 | [Hands－On_Automated_Machine_Lear_－_Sibanjan_Das30－.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Hands%EF%BC%8DOn_Automated_Machine_Lear_%EF%BC%8D_Sibanjan_Das30%EF%BC%8D.pdf) | General AutoML | Text extracted |
| 15 | 68 | [High-Frequency Trading Strategies.pdf](https://github.com/LucindaYa/quant-resources/blob/master/High-Frequency%20Trading%20Strategies.pdf) | HFT order-book signals | Text extracted |
| 16 | 56 | [High-frequency trading strategies1.pdf](https://github.com/LucindaYa/quant-resources/blob/master/High-frequency%20trading%20strategies1.pdf) | HFT order-book signals | Text extracted |
| 17 | 26 | [High-frequency trading strategies2.pdf](https://github.com/LucindaYa/quant-resources/blob/master/High-frequency%20trading%20strategies2.pdf) | HFT presentation | Text extracted |
| 18 | 10 | [Linear regression, active learning.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Linear%20regression%2C%20active%20learning.pdf) | Regression and active learning | Text extracted |
| 19 | 1098 | [ML Machine Learning-A Probabilistic Perspective.pdf](https://github.com/LucindaYa/quant-resources/blob/master/ML%20Machine%20Learning-A%20Probabilistic%20Perspective.pdf) | Probabilistic ML | Text extracted |
| 20 | 29 | [Market microstructure and market liquidity.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Market%20microstructure%20and%20market%20liquidity.pdf) | Liquidity and microstructure | Text extracted |
| 21 | 214 | [Michael Moore - Advanced Algorithmic Trading (2016).pdf](https://github.com/LucindaYa/quant-resources/blob/master/Michael%20Moore%20-%20Advanced%20Algorithmic%20Trading%20%282016%29.pdf) | Time series and ML | Text extracted |
| 22 | 208 | [Michael Moore - Successful Algorithmic Trading (2010).pdf](https://github.com/LucindaYa/quant-resources/blob/master/Michael%20Moore%20-%20Successful%20Algorithmic%20Trading%20%282010%29.pdf) | Backtest/system design | Text extracted |
| 23 | 97 | [Microstructure Characteristics of U.S. Futures Markets.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Microstructure%20Characteristics%20of%20U.S.%20Futures%20Markets.pdf) | Futures microstructure | Text extracted |
| 24 | 401 | [Modeling Financial Markets.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Modeling%20Financial%20Markets.pdf) | Pricing/risk software | Text extracted |
| 25 | 41 | [Optimal Strategies of High Frequency Traders.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Optimal%20Strategies%20of%20High%20Frequency%20Traders.pdf) | HFT optimal control | Text extracted |
| 26 | 476 | [PRML_Translation.pdf](https://github.com/LucindaYa/quant-resources/blob/master/PRML_Translation.pdf) | General ML | Text extracted |
| 27 | 476 | [PRML中文版_模式识别与机器学习.pdf](https://github.com/LucindaYa/quant-resources/blob/master/PRML%E4%B8%AD%E6%96%87%E7%89%88_%E6%A8%A1%E5%BC%8F%E8%AF%86%E5%88%AB%E4%B8%8E%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0.pdf) | General ML duplicate | Duplicate of #26 |
| 28 | 1232 | [Perry Kaufman - Trading Systems and Methods (5th ed) (2013).pdf](https://github.com/LucindaYa/quant-resources/blob/master/Perry%20Kaufman%20-%20Trading%20Systems%20and%20Methods%20%285th%20ed%29%20%282013%29.pdf) | Trading systems and testing | Text extracted |
| 29 | 382 | [Professional Automated Trading.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Professional%20Automated%20Trading.pdf) | Automated trading systems | Text extracted |
| 30 | 566 | [Python for Finance_ Analyze Big Financial Data \[H.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Python%20for%20Finance_%20Analyze%20Big%20Financial%20Data%20%5BH.pdf) | Python in finance | Text extracted |
| 31 | 533 | [QUANTITATIVE EQUITY INVESTING.pdf](https://github.com/LucindaYa/quant-resources/blob/master/QUANTITATIVE%20EQUITY%20INVESTING.pdf) | Equity factors | Text extracted |
| 32 | 280 | [Quality Money Management.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Quality%20Money%20Management.pdf) | Trading process and risk | Text extracted |
| 33 | 232 | [Quantitative Equity Portfolio Management.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Quantitative%20Equity%20Portfolio%20Management.pdf) | Equity portfolio management | OCR extracted |
| 34 | 204 | [Quantitative Trading How to Build Your Own Algorithmic Trading Business.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Quantitative%20Trading%20How%20to%20Build%20Your%20Own%20Algorithmic%20Trading%20Business.pdf) | Quant trading and pitfalls | Text extracted |
| 35 | 8 | [Quantitative and High Frequency Trading Training Program.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Quantitative%20and%20High%20Frequency%20Trading%20Training%20Program.pdf) | Training syllabus | Text extracted |
| 36 | 548 | [Reinforcement Learning An Introduction2018最新版.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Reinforcement%20Learning%20An%20Introduction2018%E6%9C%80%E6%96%B0%E7%89%88.pdf) | Reinforcement learning | Text extracted |
| 37 | 240 | [Rishi Narang - Inside the Black Box.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Rishi%20Narang%20-%20Inside%20the%20Black%20Box.pdf) | Quant system architecture | Text extracted |
| 38 | 81 | [Risk and Return in High-Frequency Trading .pdf](https://github.com/LucindaYa/quant-resources/blob/master/Risk%20and%20Return%20in%20High-Frequency%20Trading%20.pdf) | HFT latency and returns | Text extracted |
| 39 | 714 | [Ruey S. Tsay-Analysis of Financial Time Series%2C Third Edition %28Wiley Series in Probability and Statistics%29-John Wiley %26 Sons %282010%29.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Ruey%20S.%20Tsay-Analysis%20of%20Financial%20Time%20Series%252C%20Third%20Edition%20%2528Wiley%20Series%20in%20Probability%20and%20Statistics%2529-John%20Wiley%20%2526%20Sons%20%25282010%2529.pdf) | Financial time series | Text extracted |
| 40 | 362 | [Statistical Models and Methods for Financial Markets.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Statistical%20Models%20and%20Methods%20for%20Financial%20Markets.pdf) | Financial statistics | Text extracted |
| 41 | 63 | [Statistical arbitrage pairs trading strategies Re.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Statistical%20arbitrage%20pairs%20trading%20strategies%20Re.pdf) | Pairs-trading survey | Text extracted |
| 42 | 542 | [Statistically Sound Machine Learning for Algorithmic Trading of Financial Instruments-David_Aronson.pdf](https://github.com/LucindaYa/quant-resources/blob/master/Statistically%20Sound%20Machine%20Learning%20for%20Algorithmic%20Trading%20of%20Financial%20Instruments-David_Aronson.pdf) | ML trading validation | Text extracted |
| 43 | 34 | [THE PROBABILITY OF BACKTEST OVERFITTING.pdf](https://github.com/LucindaYa/quant-resources/blob/master/THE%20PROBABILITY%20OF%20BACKTEST%20OVERFITTING.pdf) | Backtest overfitting | Text extracted |
| 44 | 31 | [The Effects of Microstructure Noise on Realized Volatility in the Live Cattle Futures Market.pdf](https://github.com/LucindaYa/quant-resources/blob/master/The%20Effects%20of%20Microstructure%20Noise%20on%20Realized%20Volatility%20in%20the%20Live%20Cattle%20Futures%20Market.pdf) | Microstructure noise | Text extracted |
| 45 | 833 | [The Encyclopedia Of Technical Market Indicators Robert W.Colby.pdf](https://github.com/LucindaYa/quant-resources/blob/master/The%20Encyclopedia%20Of%20Technical%20Market%20Indicators%20Robert%20W.Colby.pdf) | Technical indicators | Text extracted |
| 46 | 367 | [The_Mathematics_of_Poker.pdf](https://github.com/LucindaYa/quant-resources/blob/master/The_Mathematics_of_Poker.pdf) | Poker and decision theory | Text extracted |
| 47 | 154 | [United States Equity Version 3.pdf](https://github.com/LucindaYa/quant-resources/blob/master/United%20States%20Equity%20Version%203.pdf) | Equity risk model | Text extracted |
| 48 | 154 | [United States Equity.pdf](https://github.com/LucindaYa/quant-resources/blob/master/United%20States%20Equity.pdf) | Equity risk model duplicate | Duplicate of #47 |
| 49 | 86 | [high-frequency-trading_en.pdf](https://github.com/LucindaYa/quant-resources/blob/master/high-frequency-trading_en.pdf) | HFT overview | Text extracted |
| 50 | 83 | [k线图经典图解_全集.pdf](https://github.com/LucindaYa/quant-resources/blob/master/k%E7%BA%BF%E5%9B%BE%E7%BB%8F%E5%85%B8%E5%9B%BE%E8%A7%A3_%E5%85%A8%E9%9B%86.pdf) | Candlestick patterns | Text extracted |
| 51 | 64 | [madhavan-microstructure.pdf](https://github.com/LucindaYa/quant-resources/blob/master/madhavan-microstructure.pdf) | Microstructure survey | Text extracted |
| 52 | 257 | [statistical_arbitrage.pdf](https://github.com/LucindaYa/quant-resources/blob/master/statistical_arbitrage.pdf) | Statistical arbitrage | Text extracted |
| 53 | 208 | [successful algorithmic trading.pdf](https://github.com/LucindaYa/quant-resources/blob/master/successful%20algorithmic%20trading.pdf) | Backtest/system design duplicate | Duplicate of #22 |
| 54 | 189 | [trade with oods.pdf](https://github.com/LucindaYa/quant-resources/blob/master/trade%20with%20oods.pdf) | Trading probabilities | Text extracted |
| 55 | 354 | [《Systematic_Trading》－Robert_Carver_2015.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E3%80%8ASystematic_Trading%E3%80%8B%EF%BC%8DRobert_Carver_2015.pdf) | Systematic trading and sizing | Text extracted |
| 56 | 396 | [主动投资组合管理(中文).pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E4%B8%BB%E5%8A%A8%E6%8A%95%E8%B5%84%E7%BB%84%E5%90%88%E7%AE%A1%E7%90%86%28%E4%B8%AD%E6%96%87%29.pdf) | Portfolio management | OCR extracted |
| 57 | 4 | [交易应直指人心___突破与抄底的定义程序.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E4%BA%A4%E6%98%93%E5%BA%94%E7%9B%B4%E6%8C%87%E4%BA%BA%E5%BF%83___%E7%AA%81%E7%A0%B4%E4%B8%8E%E6%8A%84%E5%BA%95%E7%9A%84%E5%AE%9A%E4%B9%89%E7%A8%8B%E5%BA%8F.pdf) | Breakout/bottom signals | Text extracted |
| 58 | 7 | [基于协整－ＧＡＲＣＨ模型最优阈值统计套利研究.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E5%9F%BA%E4%BA%8E%E5%8D%8F%E6%95%B4%EF%BC%8D%EF%BC%A7%EF%BC%A1%EF%BC%B2%EF%BC%A3%EF%BC%A8%E6%A8%A1%E5%9E%8B%E6%9C%80%E4%BC%98%E9%98%88%E5%80%BC%E7%BB%9F%E8%AE%A1%E5%A5%97%E5%88%A9%E7%A0%94%E7%A9%B6.pdf) | Cointegration and GARCH | Text extracted |
| 59 | 43 | [技术开发-贝叶斯思维：统计建模的Python学习法（迷你书）.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E6%8A%80%E6%9C%AF%E5%BC%80%E5%8F%91-%E8%B4%9D%E5%8F%B6%E6%96%AF%E6%80%9D%E7%BB%B4%EF%BC%9A%E7%BB%9F%E8%AE%A1%E5%BB%BA%E6%A8%A1%E7%9A%84Python%E5%AD%A6%E4%B9%A0%E6%B3%95%EF%BC%88%E8%BF%B7%E4%BD%A0%E4%B9%A6%EF%BC%89.pdf) | Bayesian statistics primer | OCR extracted |
| 60 | 183 | [贝叶斯思维：统计建模的PYTHON学习法.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E8%B4%9D%E5%8F%B6%E6%96%AF%E6%80%9D%E7%BB%B4%EF%BC%9A%E7%BB%9F%E8%AE%A1%E5%BB%BA%E6%A8%A1%E7%9A%84PYTHON%E5%AD%A6%E4%B9%A0%E6%B3%95.pdf) | Bayesian statistics primer | OCR extracted |
| 61 | 364 | [资金流动论完整版.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E8%B5%84%E9%87%91%E6%B5%81%E5%8A%A8%E8%AE%BA%E5%AE%8C%E6%95%B4%E7%89%88.pdf) | Capital-flow theory | Text extracted |
| 62 | 28 | [量化交易行业概览.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E9%87%8F%E5%8C%96%E4%BA%A4%E6%98%93%E8%A1%8C%E4%B8%9A%E6%A6%82%E8%A7%88.pdf) | Crypto quant industry overview | Text extracted |
| 63 | 196 | [量化投资入门到进阶.pdf](https://github.com/LucindaYa/quant-resources/blob/master/%E9%87%8F%E5%8C%96%E6%8A%95%E8%B5%84%E5%85%A5%E9%97%A8%E5%88%B0%E8%BF%9B%E9%98%B6.pdf) | Quant investing primer | Text extracted |
