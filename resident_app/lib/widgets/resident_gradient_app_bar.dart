import 'package:flutter/material.dart';

class ResidentHeaderGradients {
  static const home = [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)];
  static const emergency = [Color(0xFF991B1B), Color(0xFFE53935), Color(0xFFB91C1C)];
  static const community = [Color(0xFFB45309), Color(0xFFF39C12), Color(0xFFD97706)];
  static const reports = [Color(0xFF3730A3), Color(0xFF6366F1), Color(0xFF7C3AED)];
}

class ResidentGradientAppBar extends StatelessWidget implements PreferredSizeWidget {
  final Widget? title;
  final List<Widget>? actions;
  final Widget? leading;
  final List<Color> colors;
  final bool automaticallyImplyLeading;

  const ResidentGradientAppBar({
    super.key,
    this.title,
    this.actions,
    this.leading,
    this.colors = ResidentHeaderGradients.home,
    this.automaticallyImplyLeading = true,
  });

  @override
  Size get preferredSize {
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    final topInset = view.padding.top / view.devicePixelRatio;
    return Size.fromHeight(kToolbarHeight + topInset);
  }

  @override
  Widget build(BuildContext context) {
    final canPop = Navigator.maybeOf(context)?.canPop() ?? false;
    final effectiveLeading = leading ??
        (automaticallyImplyLeading && canPop
            ? IconButton(
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                onPressed: () => Navigator.maybeOf(context)?.maybePop(),
              )
            : null);

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: colors.first.withValues(alpha: 0.35),
            blurRadius: 16,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: kToolbarHeight,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              children: [
                if (effectiveLeading != null) ...[
                  SizedBox(width: 48, child: Center(child: effectiveLeading)),
                  const SizedBox(width: 8),
                ],
                if (title != null)
                  Expanded(
                    child: DefaultTextStyle(
                      style: Theme.of(context).textTheme.titleLarge!.copyWith(
                            color: Colors.white,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      child: title!,
                    ),
                  )
                else
                  const Spacer(),
                if (actions != null)
                  ...actions!.map(
                    (action) => IconTheme(
                      data: const IconThemeData(color: Colors.white),
                      child: action,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
