export type MenuItem = {
  id: number;
  name: string;
  price: string;
  secondPrice?: string;
  showSecondPrice?: boolean;
};

export type DrinkSection = 'coffee' | 'cold';

export type DrinkItem = {
  id: number;
  section: DrinkSection;
  name: string;
  subtitle: string;
  showSubtitle: boolean;
  price: string;
  coldPrice: string;
  showSecondPrice?: boolean;
};

export type TvLayout = 'no-drinks' | 'drinks';
